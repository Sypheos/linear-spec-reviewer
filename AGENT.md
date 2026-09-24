# AGENT.md — Linear Spec Review (Obsidian plugin)

Guidance for AI agents working on this plugin. Read this fully before editing.

## What this plugin does

Imports a **Linear project overview** into a clean Obsidian markdown note and lets
reviewers read/reply to the project's **comment threads** in a dedicated side panel.

Hard product rules (do not violate):

1. The markdown note is **only** the project overview body + project properties as
   YAML frontmatter. **Comments must NEVER be written into the markdown.** They live
   exclusively in the side panel, fetched live.
2. The Linear API key is stored **only** in Obsidian **Secret Storage**
   (`app.secretStorage` via `SecretComponent`). **No plaintext fallback.** If Secret
   Storage is unavailable, the plugin surfaces an error and refuses to store the key.
3. Comment loading is **live on demand** (panel open + manual Refresh). Never persist
   comments to disk or to `data.json`.

## Build / dev / validate

Package manager: **pnpm**. Runtime: desktop-only (`isDesktopOnly: true`).

```bash
pnpm install                      # deps are devDependencies only (no runtime deps)
pnpm build                        # tsc --noEmit (typecheck) + esbuild -> main.js
node esbuild.config.mjs production # bundle only (no typecheck)
pnpm dev                          # esbuild watch mode
```

Reload + verify in a running Obsidian (the `obsidian` CLI talks to the live app):

```bash
obsidian plugin:reload id=linear-spec-review
obsidian dev:errors                       # must print "No errors captured."
obsidian dev:screenshot path=/tmp/opencode/x.png
```

To enable the plugin the first time it must be in `.obsidian/community-plugins.json`
and enabled: `obsidian eval code='app.plugins.enablePlugin("linear-spec-review")'`.

Never `cd` in tool calls elsewhere; always operate in this plugin dir.

## Architecture (all under `src/`)

Data flows: commands/view → `linear/queries.ts` → `linear/gql.ts` → Linear GraphQL.

| File | Responsibility |
|------|----------------|
| `types.ts` | Shared types + constants. **Single source of truth** for the data contract. Frontmatter keys (`FM_*`), view type (`LINEAR_COMMENTS_VIEW`), `PluginSettings`, `DEFAULT_SETTINGS`. |
| `linear/gql.ts` | The **only** Linear I/O choke point. `linearRequest()` uses Obsidian `requestUrl` (bypasses CORS). `assertSecretStorage()` + `getApiKey()` enforce the secret-storage requirement and throw `SecretStorageUnavailableError` / `LinearError`. |
| `linear/queries.ts` | Typed GraphQL ops + Raw→domain mappers: `searchProjects`, `getProjectById`, `getProjectComments`, `createThread`, `replyToThread`. |
| `linear/parseUrl.ts` | Parse a Linear project URL → `slugId`; `resolveProjectFromUrl()` maps a URL to a concrete project via `searchProjects`. |
| `render/frontmatter.ts` | `buildFrontmatter()` — hand-rolled YAML (no yaml lib), always double-quotes scalars via `yamlString()`. |
| `render/overview.ts` | `buildNote()` = frontmatter + body. `stripLinearTags()` (defensive), `sanitizeFileName()`. |
| `commands.ts` | `ImportUrlModal`, `ProjectSuggestModal` (debounced live search), `writeProjectNote()`, `importByUrl`/`importByProject`, `openBrowseModal`. Host interface `CommandHost`. |
| `view/CommentsView.ts` | `CommentsView extends ItemView` — grouping, rendering, reply/new-thread, and click-to-scroll from an inline comment's `quotedText` to the note (`buildStripped`/`findInMarkdown`/`scrollEditorToQuotedText`). Host interface `CommentsHost`. |
| `settings.ts` | `LinearSettingTab` with `SecretComponent`. Host interface `SettingsHost`. Hard-guards secret-storage availability. |
| `main.ts` | `LinearSpecReviewPlugin` implements all three host interfaces, registers view + 3 commands, reads active-note context from frontmatter, exposes `getActiveFile()` for scroll-to-anchor. |

**Host-interface pattern:** `main.ts` is the concrete plugin and implements `CommentsHost`,
`CommandHost`, `SettingsHost`. The view/commands/settings depend only on these narrow
interfaces (declared in their own files), never importing the plugin class — this avoids
circular imports. When adding a capability the view/commands need, extend the relevant host
interface and implement it in `main.ts`.

## Linear API contract — VERIFIED, do not "fix" without re-probing

These were validated against the live API. Getting them wrong causes silent failures.

- **Auth header is `Authorization: <API_KEY>`** — NOT `Bearer <key>`.
- **Overview body = `Project.content`** (already-clean markdown). `Project.description`
  is only the short one-liner; do not render it as the body. The raw API `content` does
  **not** contain `<linear-comment>`/`<user>`/`<issue>`/`<linear-embed>` tags (those come
  from the Linear MCP tool, not the API). `stripLinearTags()` is defensive only.
- **Project overview comments anchor to `documentContentId`, NOT `projectId`.** Fetch it
  via `project { documentContent { id } }` and store it in note frontmatter
  (`linear_document_content_id`).
- **Creating a comment** (`commentCreate`):
  - New top-level thread: `{ documentContentId, body }` (+ optional `quotedText` for inline).
  - Reply: `{ documentContentId, parentId, body }`.
  - **Never pass `projectId` on a project-overview comment** — Linear rejects it with
    "incorrect parent". Exactly one root entity id must be set; for us that is
    `documentContentId`.
  - Both `createThread`/`replyToThread` return the fully-mapped `LinearComment` for what
    was just created. `submitReply`/`submitNewThread` in `CommentsView` use this to patch
    the new comment directly into the cached `lastThreads` (`patchReplyIntoCache` /
    `patchNewThreadIntoCache`) and re-render locally — **no `refresh()` call**, so posting
    never re-fetches the whole project's comments. Only a real reload (leaf-change project
    switch, manual Refresh, import) re-fetches from Linear.
- **Comment fields used:** `id, body, url, createdAt, resolvedAt, quotedText, parent{id},
  user{id,name,displayName}, botActor{id,name}`.
- **Thread grouping (client-side; API has no thread filter):**
  - Root = `parentId === null` (defensively also if parent id not in the set).
  - Inline thread ⇔ `root.quotedText !== null`; otherwise Discussion.
  - Resolved ⇔ `root.resolvedAt !== null` → **read-only badge only** (no resolve mutation).
  - Sort replies by `createdAt` asc, threads by `root.createdAt` desc.
- `searchProjects(term:)` returns `{ id, name, slugId, url }`. Project URL shape:
  `.../project/<name-slug>-<slugId>` where `slugId` is the trailing hex segment.

To re-probe the API safely, use `obsidian eval` with the global `requestUrl` (not
`require('obsidian')`, which is unavailable in the eval sandbox) and read the key via
`app.secretStorage.getSecret('linear-api-key')`. Write results to a temp file under
`/tmp/opencode/` because large async eval results may not print inline. Clean up any test
comments you create with `commentDelete`.

## Note format

Path: `<specsFolder>/<sanitized project name>.md` (default folder `Specs`). Re-import
overwrites body + frontmatter, never comments. Frontmatter carries machine keys used to
re-link the note to Linear:

- `linear_project_id` — used by `main.ts:getActiveContext()` to bind the panel to a note.
- `linear_document_content_id` — required for all comment writes.
- `linear_project_url` — reference.

Plus human keys: `name, status, lead, priority, team, start_date, target_date, labels,
linear_synced_at`. The panel only activates for the active note when
`getActiveContext()` finds a valid `linear_project_id` in its frontmatter cache.

## Conventions / gotchas

- **Strict TypeScript**: `strict`, `noImplicitAny`, `strictNullChecks`. No `any`; narrow
  caught errors with `e instanceof Error ? e.message : String(e)`.
- Errors from the Linear layer are thrown as `LinearError`; UI code catches and shows
  `new Notice(msg)`. Never let a handler throw uncaught into Obsidian.
- CSS classes are prefixed `lsr-` and live in `styles.css`; use CSS variables
  (`var(--...)`) for theming, not hardcoded colors.
- `esbuild.config.mjs` marks `obsidian`, `electron`, and CodeMirror packages as external.
  `main.js` is the committed build artifact Obsidian loads.
- `data.json` persists only `{ secretName, specsFolder }` — **never** the key itself.
- The `SecretComponent` / `Setting.addComponent` APIs require a recent Obsidian
  (typings present in `obsidian` >= ~1.13). If typecheck complains, update the dev dep.

## When extending

- New Linear operation → add to `linear/queries.ts` (mapper + typed fn), route through
  `linearRequest`. Do not call `requestUrl` elsewhere.
- New UI needing plugin state → extend the relevant host interface, implement in `main.ts`.
- Always finish with: `pnpm build` (0 TS errors) → `obsidian plugin:reload` →
  `obsidian dev:errors` (clean) → screenshot/DOM check against a real project.

## Feature: scroll-to-anchor on inline comment click (IMPLEMENTED)

**Status: implemented and verified.** Clicking the `quotedText` block of an inline comment
in the panel scrolls the editor to the anchored text and selects it. All logic lives in
`view/CommentsView.ts` and uses **only** Obsidian's stable `Editor` API — no CM6 internals.

### What Linear stores (the matching problem)

`Comment.quotedText` is **the only** anchor mechanism in the entire Linear GraphQL schema.
There is no character offset, block ID, ProseMirror range, or any positional field, so the
match must be done client-side by string search. Additionally, `quotedText` is stored as
**plain text** with markdown syntax stripped (no backticks, no `**bold**`, no `\[escaped\]`,
smart quotes normalized), while the note on disk is raw markdown. A plain `indexOf` only
works for snippets with no inline formatting; anything spanning code/emphasis needs a
position-preserving stripper.

### How it works (the shipped design)

1. **`getActiveFile()`** on `CommentsHost` (implemented in `main.ts`) returns the active
   `.md` `TFile`. The note is read fresh from the vault via `app.vault.read(file)` — we
   match against the same on-disk markdown the reviewer sees, not the CM6 buffer.
2. **`buildStripped(raw)`** builds a plain-text projection of the raw markdown plus a
   parallel `rawOffsets[]` array mapping every stripped char back to its raw offset (with a
   trailing sentinel = `raw.length` for exclusive-end resolution). Transforms: drop backtick
   runs, drop `*`/`_` emphasis runs (≤3 chars), backslash-unescape (mapped to the backslash
   offset so the range covers both chars), normalize smart quotes/dashes/ellipsis to ASCII.
3. **`findInMarkdown(raw, needle)`** → `{ from, to } | null`. Fast path: verbatim `indexOf`.
   Slow path: normalize the needle, `indexOf` in the stripped projection, map boundaries
   back through `rawOffsets`.
4. **`offsetToPosition(content, offset)`** converts a byte offset to Obsidian `{ line, ch }`.
5. **`scrollEditorToQuotedText(quoted)`** wires it together: get `MarkdownView` via
   `app.workspace.getActiveViewOfType(MarkdownView)`, read the file, `findInMarkdown`,
   `setActiveLeaf(view.leaf, { focus: true })`, then `editor.setSelection(from, to)` +
   `editor.scrollIntoView({ from, to }, true)`. Not found → `Notice` and leave the editor
   untouched (expected when the spec was edited after the comment was anchored).

The click handler is on `.lsr-quoted.lsr-quoted-clickable` in `renderInlineSection`.

### Why selection, not a CM6 decoration highlight

The original goal was a transient `<mark>` highlight via a CM6 `StateField` decoration.
That path is a dead end in Obsidian and was abandoned; **`editor.setSelection` gives clear
visual feedback with zero CM6 coupling**, so we use it. Do not reintroduce CM6 decorations
without re-reading the historical findings below.

Obsidian bundles CM6 (`@codemirror/state`, `@codemirror/view`) internally and does **not**
expose them as CJS modules (`require('@codemirror/state')` throws at runtime):

- **Keep `@codemirror/*` external** → compiled `require('@codemirror/state')` fails, so
  `StateEffect`/`StateField`/`Decoration` are all `undefined`.
- **Bundle `@codemirror/*`** → our `Decoration.set()` / `RangeSet.empty` are a different
  object identity than Obsidian's internal singleton, so the provide hook crashes with
  `TypeError: Cannot read properties of undefined (reading 'isEmpty')`.
- **DOM-inject a `<mark>`** → CM6 re-renders the line on the next measure and wipes it
  within ~1 animation frame.

Reusable building blocks that *were* verified working, if a highlight is ever revisited:
`cm.coordsAtPos(from, 1)`, `document.caretRangeFromPoint(x, y)`, `document.createRange()` +
`surroundContents`, runtime `Decoration` via `Object.getPrototypeOf(decoInstance.constructor)`,
and the decorations facet at `cm.constructor.decorations`. The blocker was obtaining
`StateEffect.define`/`StateField.define` from Obsidian's runtime instance — not reachable via
any inspectable path. (`obsidian.d.ts` exports `editorEditorField: StateField<EditorView>`,
whose `.constructor` is the runtime `StateField` class; that is the only known lead.)

### Verification (against the live Shopify project, 17 inline comments)

- 10/10 snippets still present in the note matched exactly — including inline-code
  (`` `Recurring payments…` ``), bold runs, escaped `\[US-3\]`, and smart apostrophe
  (`Upfluence's`). Selection landed on the correct raw range and the viewport scrolled.
- 7/7 snippets whose note text had drifted (edited/removed since the comment) correctly
  returned `null` → `Notice`, no wrong jump, prior selection left intact.

### Gotcha: unrelated CM6 `isEmpty` crash noise

If `obsidian dev:errors` shows a flood of `Cannot read properties of undefined (reading
'isEmpty')` with **only internal `app.js` frames** (`e.from`/`e.spans`/`computeVisibleRanges`),
that is a **different plugin's** broken CM6 decoration provider, not this one. It reproduces
with `linear-spec-review` fully unloaded (e.g. a bare `cm.dispatch({selection})` throws) and
was traced to the **LanguageTool Integration** plugin; it disappeared once that plugin was
uninstalled and Obsidian restarted. The extension stays baked into an already-open editor
until the note is reopened or the app restarts. As a safety net, `scrollEditorToQuotedText`
wraps its `setSelection`/`scrollIntoView` in try/catch (logs via `console.debug`) so a hostile
workspace can never surface an uncaught error from this click handler.
