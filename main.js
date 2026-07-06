"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => LinearSpecReviewPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian5 = require("obsidian");

// src/types.ts
var DEFAULT_SETTINGS = {
  secretName: "",
  specsFolder: "Specs"
};
var LINEAR_COMMENTS_VIEW = "linear-spec-review-comments";
var FM_PROJECT_ID = "linear_project_id";
var FM_DOCUMENT_CONTENT_ID = "linear_document_content_id";
var FM_PROJECT_URL = "linear_project_url";

// src/linear/gql.ts
var import_obsidian = require("obsidian");
var LINEAR_ENDPOINT = "https://api.linear.app/graphql";
var LinearError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "LinearError";
  }
};
var SecretStorageUnavailableError = class extends LinearError {
  constructor() {
    super(
      "Linear Spec Review requires Obsidian's Secret Storage (app.secretStorage), which is not available in this Obsidian version. Update Obsidian to use this plugin."
    );
    this.name = "SecretStorageUnavailableError";
  }
};
function assertSecretStorage(app) {
  const ss = app.secretStorage;
  if (!ss || typeof ss.getSecret !== "function") {
    throw new SecretStorageUnavailableError();
  }
}
function getApiKey(app, secretName) {
  assertSecretStorage(app);
  if (!secretName) {
    throw new LinearError(
      "No Linear API key configured. Open the plugin settings and select a secret."
    );
  }
  const ss = app.secretStorage;
  const key = ss.getSecret(secretName);
  if (!key) {
    throw new LinearError(
      `The secret "${secretName}" is empty or not found in Secret Storage. Re-select or re-enter your Linear API key in the plugin settings.`
    );
  }
  return key;
}
async function linearRequest(app, secretName, query, variables) {
  const apiKey = getApiKey(app, secretName);
  let res;
  try {
    res = await (0, import_obsidian.requestUrl)({
      url: LINEAR_ENDPOINT,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey
      },
      body: JSON.stringify({ query, variables: variables ?? {} }),
      throw: false
    });
  } catch (e) {
    throw new LinearError(
      `Network error contacting Linear: ${e.message ?? String(e)}`
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new LinearError(
      "Linear rejected the API key (unauthorized). Check the key in plugin settings."
    );
  }
  let json;
  try {
    json = res.json;
  } catch {
    throw new LinearError(
      `Unexpected non-JSON response from Linear (HTTP ${res.status}).`
    );
  }
  if (json.errors && json.errors.length > 0) {
    const msg = json.errors.map((e) => e.extensions?.userPresentableMessage ?? e.message).join("; ");
    throw new LinearError(`Linear API error: ${msg}`);
  }
  if (!json.data) {
    throw new LinearError(
      `Linear returned no data (HTTP ${res.status}).`
    );
  }
  return json.data;
}

// src/view/CommentsView.ts
var import_obsidian2 = require("obsidian");

// src/linear/queries.ts
var PROJECT_FIELDS = `
  id
  name
  url
  slugId
  icon
  color
  content
  description
  priority
  priorityLabel
  startDate
  targetDate
  lead { id name displayName }
  status { id name type }
  teams { nodes { key name } }
  labels { nodes { name } }
  documentContent { id }
`;
var COMMENT_FIELDS = `
  id
  body
  url
  createdAt
  resolvedAt
  quotedText
  parent { id }
  user { id name displayName }
  botActor { id name }
`;
function mapProject(p) {
  return {
    id: p.id,
    name: p.name,
    url: p.url,
    slugId: p.slugId,
    icon: p.icon,
    color: p.color,
    content: p.content ?? "",
    description: p.description ?? "",
    priority: p.priority,
    priorityLabel: p.priorityLabel,
    startDate: p.startDate,
    targetDate: p.targetDate,
    lead: p.lead ?? null,
    status: p.status ?? null,
    teams: p.teams?.nodes ?? [],
    labels: (p.labels?.nodes ?? []).map((l) => l.name),
    documentContentId: p.documentContent?.id ?? null
  };
}
function mapComment(c) {
  return {
    id: c.id,
    body: c.body,
    url: c.url,
    createdAt: c.createdAt,
    resolvedAt: c.resolvedAt,
    quotedText: c.quotedText,
    parentId: c.parent?.id ?? null,
    author: c.user ?? null,
    botActorName: c.botActor?.name ?? null
  };
}
async function searchProjects(app, secretName, term) {
  const query = `query($t: String!) {
    searchProjects(term: $t) {
      nodes { id name slugId url }
    }
  }`;
  const data = await linearRequest(app, secretName, query, { t: term });
  return data.searchProjects.nodes;
}
async function getProjectById(app, secretName, id) {
  const query = `query($id: String!) {
    project(id: $id) { ${PROJECT_FIELDS} }
  }`;
  const data = await linearRequest(
    app,
    secretName,
    query,
    { id }
  );
  return mapProject(data.project);
}
async function getProjectComments(app, secretName, projectId) {
  const query = `query($id: String!) {
    project(id: $id) {
      comments(first: 250) {
        nodes { ${COMMENT_FIELDS} }
      }
    }
  }`;
  const data = await linearRequest(app, secretName, query, { id: projectId });
  return data.project.comments.nodes.map(mapComment);
}
async function createThread(app, secretName, documentContentId, body, quotedText) {
  if (!documentContentId) {
    throw new LinearError(
      "Cannot create a comment: this project has no document content id."
    );
  }
  const mutation = `mutation($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment { ${COMMENT_FIELDS} }
    }
  }`;
  const input = { documentContentId, body };
  if (quotedText) input.quotedText = quotedText;
  const data = await linearRequest(app, secretName, mutation, { input });
  if (!data.commentCreate.success) {
    throw new LinearError("Linear reported the comment was not created.");
  }
  return mapComment(data.commentCreate.comment);
}
async function replyToThread(app, secretName, documentContentId, parentId, body) {
  const mutation = `mutation($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment { ${COMMENT_FIELDS} }
    }
  }`;
  const input = { documentContentId, parentId, body };
  const data = await linearRequest(app, secretName, mutation, { input });
  if (!data.commentCreate.success) {
    throw new LinearError("Linear reported the reply was not created.");
  }
  return mapComment(data.commentCreate.comment);
}

// src/view/CommentsView.ts
function errorMessage(e) {
  return e instanceof Error ? e.message : String(e);
}
function authorName(comment) {
  return comment.author?.name ?? comment.botActorName ?? "Unknown";
}
function formatTimestamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString();
}
var CommentsView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.bodyEl = null;
    this.headerTitleEl = null;
    this.host = plugin;
  }
  getViewType() {
    return LINEAR_COMMENTS_VIEW;
  }
  getDisplayText() {
    return "Linear comments";
  }
  getIcon() {
    return "message-square";
  }
  async onOpen() {
    this.renderShell();
    await this.refresh();
  }
  async onClose() {
    this.contentEl.empty();
  }
  /** Public entry point used by the plugin when the active leaf changes or via command. */
  async reload() {
    await this.refresh();
  }
  /** Build the persistent shell (header + body container) once per open. */
  renderShell() {
    const root = this.contentEl;
    root.empty();
    root.addClass("lsr-comments-view");
    const header = root.createDiv({ cls: "lsr-header" });
    this.headerTitleEl = header.createDiv({ cls: "lsr-header-title" });
    const actions = header.createDiv({ cls: "lsr-header-actions" });
    const refreshBtn = actions.createEl("button", {
      cls: "lsr-btn lsr-refresh-btn",
      attr: { "aria-label": "Refresh", type: "button" }
    });
    (0, import_obsidian2.setIcon)(refreshBtn, "refresh-cw");
    refreshBtn.createSpan({ text: "Refresh" });
    refreshBtn.addEventListener("click", () => {
      void this.refresh();
    });
    const newBtn = actions.createEl("button", {
      cls: "lsr-btn lsr-new-comment-btn",
      attr: { "aria-label": "New comment", type: "button" }
    });
    (0, import_obsidian2.setIcon)(newBtn, "plus");
    newBtn.createSpan({ text: "New comment" });
    newBtn.addEventListener("click", () => {
      this.focusNewThreadComposer();
    });
    this.bodyEl = root.createDiv({ cls: "lsr-body" });
  }
  /** Reload comments live from Linear and re-render the body. */
  async refresh() {
    if (this.bodyEl === null) {
      this.renderShell();
    }
    const body = this.bodyEl;
    if (body === null) {
      return;
    }
    body.empty();
    const ctx = this.host.getActiveContext();
    this.setHeaderTitle(ctx !== null ? ctx.projectName : "No Linear note active");
    if (ctx === null) {
      body.createDiv({
        cls: "lsr-empty",
        text: "Open an imported Linear spec note to see its comments."
      });
      return;
    }
    const secretName = this.host.getSecretName();
    body.createDiv({ cls: "lsr-loading", text: "Loading comments\u2026" });
    let comments;
    try {
      comments = await getProjectComments(
        this.host.app,
        secretName,
        ctx.projectId
      );
    } catch (e) {
      const msg = errorMessage(e);
      new import_obsidian2.Notice(msg);
      body.empty();
      body.createDiv({ cls: "lsr-error", text: msg });
      return;
    }
    body.empty();
    const grouped = this.groupComments(comments);
    this.renderInlineSection(body, grouped.inline, ctx);
    this.renderDiscussionSection(body, grouped.discussion, ctx);
  }
  setHeaderTitle(text) {
    if (this.headerTitleEl !== null) {
      this.headerTitleEl.setText(text);
    }
  }
  /**
   * Group a flat list of comments into inline/discussion threads.
   *
   * - Roots are comments with parentId === null (or whose parent is missing
   *   from the set, treated defensively as their own root).
   * - Replies attach to the root referenced by parentId.
   * - Replies are sorted by createdAt ascending; threads by root.createdAt
   *   descending.
   */
  groupComments(comments) {
    const byId = /* @__PURE__ */ new Map();
    for (const c of comments) {
      byId.set(c.id, c);
    }
    const threads = /* @__PURE__ */ new Map();
    for (const c of comments) {
      const isRoot = c.parentId === null || !byId.has(c.parentId);
      if (isRoot) {
        threads.set(c.id, {
          root: c,
          replies: [],
          isInline: c.quotedText !== null
        });
      }
    }
    for (const c of comments) {
      if (c.parentId === null) {
        continue;
      }
      const parentThread = threads.get(c.parentId);
      if (parentThread === void 0) {
        if (!threads.has(c.id)) {
          threads.set(c.id, {
            root: c,
            replies: [],
            isInline: c.quotedText !== null
          });
        }
        continue;
      }
      parentThread.replies.push(c);
    }
    const all = Array.from(threads.values());
    for (const t of all) {
      t.replies.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    all.sort((a, b) => b.root.createdAt.localeCompare(a.root.createdAt));
    const inline = [];
    const discussion = [];
    for (const t of all) {
      if (t.isInline) {
        inline.push(t);
      } else {
        discussion.push(t);
      }
    }
    return { inline, discussion };
  }
  renderInlineSection(container, threads, ctx) {
    const section = container.createDiv({ cls: "lsr-section lsr-inline-section" });
    section.createEl("h3", { cls: "lsr-section-title", text: "Inline comments" });
    if (threads.length === 0) {
      section.createDiv({ cls: "lsr-empty", text: "No inline comments." });
      return;
    }
    for (const thread of threads) {
      const threadEl = section.createDiv({ cls: "lsr-thread lsr-inline-thread" });
      const quoted = thread.root.quotedText;
      if (quoted !== null && quoted.length > 0) {
        threadEl.createDiv({ cls: "lsr-quoted", text: quoted });
      }
      this.renderThreadBodies(threadEl, thread, ctx);
    }
  }
  renderDiscussionSection(container, threads, ctx) {
    const section = container.createDiv({
      cls: "lsr-section lsr-discussion-section"
    });
    section.createEl("h3", { cls: "lsr-section-title", text: "Discussion" });
    this.renderNewThreadComposer(section, ctx);
    if (threads.length === 0) {
      section.createDiv({ cls: "lsr-empty", text: "No discussion comments." });
      return;
    }
    for (const thread of threads) {
      const threadEl = section.createDiv({
        cls: "lsr-thread lsr-discussion-thread"
      });
      this.renderThreadBodies(threadEl, thread, ctx);
    }
  }
  /** Render the root comment, its replies, resolved badge, and reply box. */
  renderThreadBodies(threadEl, thread, ctx) {
    const resolved = thread.root.resolvedAt !== null;
    if (resolved) {
      threadEl.addClass("lsr-thread-resolved");
    }
    this.renderComment(threadEl, thread.root, resolved);
    for (const reply of thread.replies) {
      this.renderComment(threadEl, reply, false);
    }
    this.renderReplyBox(threadEl, thread.root.id, ctx);
  }
  /** Render a single comment card. `showResolved` adds the read-only badge. */
  renderComment(container, comment, showResolved) {
    const commentEl = container.createDiv({ cls: "lsr-comment" });
    const meta = commentEl.createDiv({ cls: "lsr-comment-meta" });
    meta.createSpan({ cls: "lsr-comment-author", text: authorName(comment) });
    meta.createSpan({
      cls: "lsr-comment-time",
      text: formatTimestamp(comment.createdAt)
    });
    if (showResolved) {
      meta.createSpan({ cls: "lsr-resolved-badge", text: "Resolved" });
    }
    const bodyEl = commentEl.createDiv({ cls: "lsr-comment-body" });
    void import_obsidian2.MarkdownRenderer.render(
      this.host.app,
      comment.body,
      bodyEl,
      "",
      this
    ).catch((e) => {
      bodyEl.setText(comment.body);
      new import_obsidian2.Notice(`Failed to render comment: ${errorMessage(e)}`);
    });
  }
  /** Render the reply composer for a thread. */
  renderReplyBox(threadEl, parentId, ctx) {
    const box = threadEl.createDiv({ cls: "lsr-reply-box" });
    const textarea = box.createEl("textarea", {
      cls: "lsr-reply-input",
      attr: { placeholder: "Reply\u2026", rows: "2" }
    });
    const button = box.createEl("button", {
      cls: "lsr-btn lsr-reply-btn",
      text: "Reply",
      attr: { type: "button" }
    });
    button.addEventListener("click", () => {
      void this.submitReply(textarea, button, parentId, ctx);
    });
  }
  async submitReply(textarea, button, parentId, ctx) {
    const body = textarea.value.trim();
    if (body.length === 0) {
      new import_obsidian2.Notice("Reply cannot be empty.");
      return;
    }
    button.disabled = true;
    textarea.disabled = true;
    try {
      await replyToThread(
        this.host.app,
        this.host.getSecretName(),
        ctx.documentContentId,
        parentId,
        body
      );
      new import_obsidian2.Notice("Reply posted.");
      await this.refresh();
    } catch (e) {
      new import_obsidian2.Notice(errorMessage(e));
      button.disabled = false;
      textarea.disabled = false;
    }
  }
  /** Render the top-of-discussion composer for creating a brand-new thread. */
  renderNewThreadComposer(container, ctx) {
    const box = container.createDiv({ cls: "lsr-reply-box lsr-new-thread-box" });
    const textarea = box.createEl("textarea", {
      cls: "lsr-reply-input lsr-new-thread-input",
      attr: { placeholder: "Start a new discussion\u2026", rows: "3" }
    });
    const button = box.createEl("button", {
      cls: "lsr-btn lsr-new-thread-btn",
      text: "New thread",
      attr: { type: "button" }
    });
    button.addEventListener("click", () => {
      void this.submitNewThread(textarea, button, ctx);
    });
  }
  async submitNewThread(textarea, button, ctx) {
    const body = textarea.value.trim();
    if (body.length === 0) {
      new import_obsidian2.Notice("Comment cannot be empty.");
      return;
    }
    button.disabled = true;
    textarea.disabled = true;
    try {
      await createThread(
        this.host.app,
        this.host.getSecretName(),
        ctx.documentContentId,
        body
      );
      new import_obsidian2.Notice("Comment posted.");
      await this.refresh();
    } catch (e) {
      new import_obsidian2.Notice(errorMessage(e));
      button.disabled = false;
      textarea.disabled = false;
    }
  }
  /** Scroll to and focus the new-thread composer (used by the header button). */
  focusNewThreadComposer() {
    if (this.bodyEl === null) {
      return;
    }
    const input = this.bodyEl.querySelector(
      ".lsr-new-thread-input"
    );
    if (input !== null) {
      input.scrollIntoView({ block: "center" });
      input.focus();
    } else {
      new import_obsidian2.Notice("Open a Linear spec note to add a comment.");
    }
  }
};

// src/settings.ts
var import_obsidian3 = require("obsidian");
function errorMessage2(e) {
  return e instanceof Error ? e.message : String(e);
}
var LinearSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  /** Persist settings, surfacing any failure to the user via a Notice. */
  async persist() {
    try {
      await this.plugin.saveSettings();
    } catch (e) {
      new import_obsidian3.Notice(`Failed to save settings: ${errorMessage2(e)}`);
    }
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const secretStorage = this.app.secretStorage;
    if (typeof import_obsidian3.SecretComponent === "undefined" || !secretStorage) {
      containerEl.createEl("p", {
        cls: "lsr-settings-error",
        text: "This plugin requires Obsidian Secret Storage, which is unavailable. Update Obsidian."
      });
      return;
    }
    new import_obsidian3.Setting(containerEl).setName("Linear API key").setDesc(
      "Select or create a secret in Obsidian Secret Storage that holds your Linear personal API key."
    ).addComponent(
      (el) => new import_obsidian3.SecretComponent(this.app, el).setValue(this.plugin.settings.secretName).onChange(async (value) => {
        this.plugin.settings.secretName = value;
        await this.persist();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Specs folder").setDesc("Vault-relative folder where imported specs are written.").addText(
      (text) => text.setPlaceholder("Specs").setValue(this.plugin.settings.specsFolder).onChange(async (value) => {
        const trimmed = value.trim();
        this.plugin.settings.specsFolder = trimmed.length > 0 ? trimmed : "Specs";
        await this.persist();
      })
    );
  }
};

// src/commands.ts
var import_obsidian4 = require("obsidian");

// src/linear/parseUrl.ts
function parseProjectUrl(input) {
  const trimmed = input.trim();
  const match = trimmed.match(
    /linear\.app\/[^/]+\/project\/([^/?#]+)/i
  );
  if (!match) return null;
  const slug = match[1];
  const parts = slug.split("-");
  const slugId = parts[parts.length - 1];
  if (!slugId) return null;
  return { slug, slugId };
}
function slugToTerm(slug) {
  const parts = slug.split("-");
  parts.pop();
  return parts.join(" ");
}
async function resolveProjectFromUrl(app, secretName, url) {
  const parsed = parseProjectUrl(url);
  if (!parsed) {
    throw new LinearError(
      "That does not look like a Linear project URL (expected .../project/<name>-<id>)."
    );
  }
  const term = slugToTerm(parsed.slug) || parsed.slugId;
  const results = await searchProjects(app, secretName, term);
  const bySlugId = results.find((r) => r.slugId === parsed.slugId);
  if (bySlugId) return bySlugId;
  const byUrl = results.find((r) => r.url.includes(parsed.slugId));
  if (byUrl) return byUrl;
  const bySlug = results.find((r) => r.url.includes(parsed.slug));
  if (bySlug) return bySlug;
  throw new LinearError(
    `Could not find a project matching "${parsed.slug}". You may not have access, or the URL is stale. Try Browse instead.`
  );
}

// src/render/frontmatter.ts
function yamlString(value) {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}
function buildFrontmatter(project) {
  const statusName = project.status !== null ? project.status.name : "";
  const leadName = project.lead !== null ? project.lead.name : "";
  const documentContentId = project.documentContentId !== null ? project.documentContentId : "";
  const startDate = project.startDate !== null ? project.startDate : "";
  const targetDate = project.targetDate !== null ? project.targetDate : "";
  const teamKeys = project.teams.map((team) => team.key).join(", ");
  const syncedAt = (/* @__PURE__ */ new Date()).toISOString();
  const lines = [];
  lines.push("---");
  lines.push(`${FM_PROJECT_ID}: ${yamlString(project.id)}`);
  lines.push(`${FM_DOCUMENT_CONTENT_ID}: ${yamlString(documentContentId)}`);
  lines.push(`${FM_PROJECT_URL}: ${yamlString(project.url)}`);
  lines.push(`name: ${yamlString(project.name)}`);
  lines.push(`status: ${yamlString(statusName)}`);
  lines.push(`lead: ${yamlString(leadName)}`);
  lines.push(`priority: ${yamlString(project.priorityLabel)}`);
  lines.push(`team: ${yamlString(teamKeys)}`);
  lines.push(`start_date: ${yamlString(startDate)}`);
  lines.push(`target_date: ${yamlString(targetDate)}`);
  if (project.labels.length === 0) {
    lines.push("labels: []");
  } else {
    lines.push("labels:");
    for (const label of project.labels) {
      lines.push(`  - ${yamlString(label)}`);
    }
  }
  lines.push(`linear_synced_at: ${yamlString(syncedAt)}`);
  lines.push("---");
  return `${lines.join("\n")}
`;
}

// src/render/overview.ts
function stripLinearTags(md) {
  let out = md;
  out = out.replace(/<linear-embed\b[^>]*>[\s\S]*?<\/linear-embed>/g, "");
  out = out.replace(/<linear-embed\b[^>]*\/>/g, "");
  out = out.replace(/<linear-comment\b[^>]*>/g, "");
  out = out.replace(/<\/linear-comment>/g, "");
  out = out.replace(/<user\b[^>]*>([\s\S]*?)<\/user>/g, "$1");
  out = out.replace(/<issue\b[^>]*>([\s\S]*?)<\/issue>/g, "$1");
  return out;
}
function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim();
}
function buildNote(project) {
  const frontmatter = buildFrontmatter(project);
  const body = stripLinearTags(project.content);
  return `${frontmatter}
${body}`;
}

// src/commands.ts
function errorMessage3(e) {
  return e instanceof Error ? e.message : String(e);
}
var ImportUrlModal = class extends import_obsidian4.Modal {
  constructor(app, onSubmit) {
    super(app);
    this.url = "";
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Import Linear project by URL" });
    new import_obsidian4.Setting(contentEl).setName("Project URL").addText((text) => {
      text.setPlaceholder("https://linear.app/workspace/project/\u2026").onChange((value) => {
        this.url = value;
      });
      text.inputEl.style.width = "100%";
      text.inputEl.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter") {
          evt.preventDefault();
          this.submit();
        }
      });
    });
    new import_obsidian4.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("Import").setCta().onClick(() => this.submit())
    );
  }
  submit() {
    const value = this.url.trim();
    if (value.length === 0) {
      new import_obsidian4.Notice("Please paste a Linear project URL.");
      return;
    }
    this.close();
    this.onSubmit(value);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ProjectSuggestModal = class extends import_obsidian4.FuzzySuggestModal {
  constructor(app, loader, onChoose) {
    super(app);
    this.items = [];
    this.debounce = null;
    this.loader = loader;
    this.onChoose = onChoose;
    this.setPlaceholder("Type to search Linear projects\u2026");
  }
  getItems() {
    return this.items;
  }
  getItemText(item) {
    return item.name;
  }
  onChooseItem(item) {
    this.onChoose(item);
  }
  // Re-query Linear as the user types (debounced), then refresh suggestions.
  onOpen() {
    super.onOpen();
    this.inputEl.addEventListener("input", () => {
      const term = this.inputEl.value.trim();
      if (this.debounce !== null) {
        window.clearTimeout(this.debounce);
      }
      this.debounce = window.setTimeout(() => {
        void this.runSearch(term);
      }, 250);
    });
  }
  async runSearch(term) {
    if (term.length === 0) {
      this.items = [];
      this.updateSuggestions?.();
      return;
    }
    try {
      this.items = await this.loader(term);
    } catch (e) {
      new import_obsidian4.Notice(errorMessage3(e));
      this.items = [];
    }
    this.updateSuggestions?.();
  }
};
async function writeProjectNote(host, project) {
  const app = host.app;
  const folder = host.getSpecsFolder().replace(/^\/+|\/+$/g, "") || "Specs";
  const base = sanitizeFileName(project.name) || project.slugId;
  const path = (0, import_obsidian4.normalizePath)(`${folder}/${base}.md`);
  const folderPath = (0, import_obsidian4.normalizePath)(folder);
  if (folder.length > 0 && app.vault.getAbstractFileByPath(folderPath) === null) {
    await app.vault.createFolder(folderPath).catch(() => {
    });
  }
  const content = buildNote(project);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof import_obsidian4.TFile) {
    await app.vault.modify(existing, content);
    return existing;
  }
  return await app.vault.create(path, content);
}
async function importByUrl(host, url) {
  const secretName = host.getSecretName();
  try {
    new import_obsidian4.Notice("Resolving Linear project\u2026");
    const match = await resolveProjectFromUrl(
      host.app,
      secretName,
      url
    );
    const project = await getProjectById(host.app, secretName, match.id);
    const file = await writeProjectNote(host, project);
    await host.app.workspace.getLeaf(false).openFile(file);
    await host.onImported(file);
    new import_obsidian4.Notice(`Imported "${project.name}".`);
  } catch (e) {
    new import_obsidian4.Notice(errorMessage3(e));
  }
}
async function importByProject(host, projectId) {
  const secretName = host.getSecretName();
  try {
    const project = await getProjectById(host.app, secretName, projectId);
    const file = await writeProjectNote(host, project);
    await host.app.workspace.getLeaf(false).openFile(file);
    await host.onImported(file);
    new import_obsidian4.Notice(`Imported "${project.name}".`);
  } catch (e) {
    new import_obsidian4.Notice(errorMessage3(e));
  }
}
function openBrowseModal(host) {
  const secretName = host.getSecretName();
  const modal = new ProjectSuggestModal(
    host.app,
    (term) => searchProjects(host.app, secretName, term),
    (project) => {
      void importByProject(host, project.id);
    }
  );
  modal.open();
}

// src/main.ts
var LinearSpecReviewPlugin = class extends import_obsidian5.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
  }
  async onload() {
    await this.loadSettings();
    try {
      assertSecretStorage(this.app);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new import_obsidian5.Notice(`Linear Spec Review: ${msg}`);
      console.error("[linear-spec-review]", msg);
    }
    this.registerView(
      LINEAR_COMMENTS_VIEW,
      (leaf) => new CommentsView(leaf, this)
    );
    this.addSettingTab(new LinearSettingTab(this.app, this));
    this.addCommand({
      id: "import-project-url",
      name: "Import project overview (URL)",
      callback: () => {
        new ImportUrlModal(this.app, (url) => {
          void importByUrl(this, url);
        }).open();
      }
    });
    this.addCommand({
      id: "browse-import-project",
      name: "Browse & import project",
      callback: () => {
        openBrowseModal(this);
      }
    });
    this.addCommand({
      id: "open-comments-panel",
      name: "Open comments panel",
      callback: () => {
        void this.activateCommentsView();
      }
    });
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        void this.refreshCommentsView();
      })
    );
  }
  onunload() {
  }
  // --- Settings persistence -------------------------------------------------
  async loadSettings() {
    const data = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...data ?? {} };
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  // --- CommentsHost / CommandHost ------------------------------------------
  getSecretName() {
    return this.settings.secretName;
  }
  getSpecsFolder() {
    return this.settings.specsFolder;
  }
  /** Reads the active markdown note's Linear context from its frontmatter. */
  getActiveContext() {
    const file = this.app.workspace.getActiveFile();
    if (file === null || file.extension !== "md") {
      return null;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (fm === void 0) {
      return null;
    }
    const projectId = fm[FM_PROJECT_ID];
    if (typeof projectId !== "string" || projectId.length === 0) {
      return null;
    }
    const documentContentId = typeof fm[FM_DOCUMENT_CONTENT_ID] === "string" ? fm[FM_DOCUMENT_CONTENT_ID] : "";
    const projectName = typeof fm["name"] === "string" ? fm["name"] : file.basename;
    return { projectId, documentContentId, projectName };
  }
  async onImported(_file) {
    await this.activateCommentsView();
    await this.refreshCommentsView();
  }
  // --- View management ------------------------------------------------------
  async activateCommentsView() {
    const existing = this.app.workspace.getLeavesOfType(LINEAR_COMMENTS_VIEW);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf === null) {
      new import_obsidian5.Notice("Could not open the comments panel (no right sidebar).");
      return;
    }
    await leaf.setViewState({ type: LINEAR_COMMENTS_VIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  async refreshCommentsView() {
    const leaves = this.app.workspace.getLeavesOfType(LINEAR_COMMENTS_VIEW);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof CommentsView) {
        await view.reload();
      }
    }
  }
};
