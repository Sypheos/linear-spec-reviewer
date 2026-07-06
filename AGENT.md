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
| `view/CommentsView.ts` | `CommentsView extends ItemView` — grouping, rendering, reply/new-thread. Host interface `CommentsHost`. |
| `settings.ts` | `LinearSettingTab` with `SecretComponent`. Host interface `SettingsHost`. Hard-guards secret-storage availability. |
| `main.ts` | `LinearSpecReviewPlugin` implements all three host interfaces, registers view + 3 commands, reads active-note context from frontmatter. |

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

## Known unimplemented feature: scroll-to-anchor on inline comment click

**Status: not implemented. Do not attempt without reading this section in full.**

The natural next feature is clicking the `quotedText` block in the panel to scroll the
note to the anchored text and transiently highlight it. This was attempted and abandoned
due to a fundamental Obsidian CM6 constraint. The findings are documented here precisely
so future agents do not repeat the same dead ends.

### What Linear stores

`Comment.quotedText` is **the only** anchor mechanism in the entire Linear GraphQL schema.
There is no character offset, block ID, ProseMirror range, or any positional field. The
text match must be done client-side via string search. Additionally, `quotedText` is
stored as **plain text** with markdown syntax stripped (no backticks, no `**bold**`, no
`\[escaped\]`), while `project.content` is raw markdown. A simple `indexOf` only works
for snippets that contain no inline markdown. For snippets spanning code or emphasis, a
position-preserving markdown stripper is required — this part was implemented and tested.

### The CM6 singleton problem (why highlighting fails)

Obsidian bundles CM6 (`@codemirror/state`, `@codemirror/view`) internally and does **not**
expose them as CJS modules. `require('@codemirror/state')` always throws at runtime.

This creates an irreconcilable conflict for any plugin that wants to register a CM6
`StateField` decoration:

**Option A — keep `@codemirror/*` external in esbuild (31 KB bundle):**
The compiled `main.js` emits `require('@codemirror/state')` at the top, which fails at
runtime, making `StateEffect`, `StateField`, and `Decoration` all `undefined`.

**Option B — bundle `@codemirror/*` (445 KB bundle):**
Our bundled `Decoration.none` / `Decoration.set()` return objects that fail Obsidian's
runtime `.isEmpty` check (`TypeError: Cannot read properties of undefined (reading
'isEmpty')`), because our bundle's `RangeSet.empty` is a different object identity than
Obsidian's internal `RangeSet.empty`. The `facet.from(field)` call in `StateField.provide`
also uses a different `EditorView.decorations` singleton, so it either crashes or is
silently ignored.

**Option C — DOM injection (no CM6 at all):**
Inject a `<mark class="lsr-highlight">` element directly into the CM6 editor DOM after
using `cm.coordsAtPos(offset)` + `document.caretRangeFromPoint(x, y)` to locate the
text. This avoids all CM6 singleton issues and was fully verified to work in isolation.
However, CM6 re-renders lines after any scroll or layout measurement, which immediately
removes the injected `<mark>`. The injection is visible for approximately one animation
frame before being wiped. Not usable.

### What was verified during the attempt (reusable building blocks)

- `cm.coordsAtPos(from, 1)` → `{ left, right, top, bottom }` works correctly.
- `document.caretRangeFromPoint(x, y)` correctly locates text nodes.
- `document.createRange()` + `surroundContents(mark)` correctly wraps text.
- The runtime `Decoration` class is accessible via:
  `Object.getPrototypeOf(decoInstance.constructor)` from a live decoration iterator,
  and has working `.mark()`, `.none`, `.set()` static methods.
- The runtime `EditorView.decorations` facet is at `cm.constructor.decorations` and has
  `.from()` / `.of()` methods.
- `StateEffect.define()` and `StateField.define()` from the Obsidian runtime are **not**
  accessible via any inspectable path (`window`, `require`, `cm.state`, `cm.plugins`,
  transaction introspection — all exhausted).

### Correct approach for a future implementation

The only viable path is a hybrid:

1. Use runtime `StateEffect.define` and `StateField.define` — these must come from
   Obsidian's bundle. They are not directly accessible, but Obsidian re-exports
   `StateField` from `@codemirror/state` in its public API (`obsidian.d.ts` line 6:
   `import { Extension, StateField } from '@codemirror/state'`). The concrete exported
   value `editorEditorField: StateField<EditorView>` (obsidian.d.ts line 2597) is a
   `StateField` instance from Obsidian's bundle. Its `.constructor` is the runtime
   `StateField` class. Obsidian likely also exports `StateEffect` somewhere similar.
   Locate these via `Object.getPrototypeOf(app.workspace....)` introspection.

2. Use runtime `Decoration` (confirmed accessible as described above) for `.none`/`.set()`/`.mark()`.

3. Use `cm.constructor.decorations.from(field)` for the provide hook.

4. Use `cm.dispatch({ effects: [runtimeEffect.of(...)] })` for applying.

With all four from the same runtime instance, the singleton conflict is resolved.
This approach was not completed. The scroll (via `editor.scrollIntoView`) is trivial and
was already working; only the visual highlight is blocked.

### `quotedText` ↔ `project.content` matching (implemented, reusable)

The `buildStripped` + `findInMarkdown` logic that maps plain-text quotedText back to raw
markdown offsets was fully implemented, tested against the Shopify project, and **works
correctly**. If you re-implement the highlight feature, copy this from the attempt:

```ts
function buildStripped(raw: string): { stripped: string; rawOffsets: number[] }
function findInMarkdown(raw: string, needle: string): { from: number; to: number } | null
```

Key transforms: backtick-fence unwrap, `**`/`*`/`__`/`_` run skip (≤3 chars), backslash
unescape, smart apostrophe/quote → ASCII. Fast path = verbatim `indexOf` first.
