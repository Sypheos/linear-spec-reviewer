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
var import_obsidian7 = require("obsidian");

// src/types.ts
var DEFAULT_SETTINGS = {
  secretName: "",
  specsFolder: "Specs",
  storeAssetsInVault: false
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
async function downloadLinearAsset(app, secretName, url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.host !== "uploads.linear.app") {
    throw new LinearError("Refusing to download an asset outside uploads.linear.app.");
  }
  let res;
  try {
    res = await (0, import_obsidian.requestUrl)({
      url: parsed.origin + parsed.pathname,
      headers: { Authorization: getApiKey(app, secretName) },
      throw: false
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new LinearError(`Could not download Linear asset: ${message}`);
  }
  if (res.status !== 200) {
    throw new LinearError(`Linear asset download failed (HTTP ${res.status}).`);
  }
  return {
    bytes: res.arrayBuffer,
    contentType: (res.headers["content-type"] ?? "").split(";")[0].toLowerCase()
  };
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

// src/linear/assets.ts
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var import_obsidian2 = require("obsidian");
var IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml"
};
var AssetStore = class {
  constructor(app, secretName, specsFolder) {
    this.app = app;
    this.secretName = secretName;
    this.specsFolder = specsFolder;
  }
  async load(url, inVault) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.host !== "uploads.linear.app") {
      throw new LinearError("Refusing to load an image outside uploads.linear.app.");
    }
    const stem = (0, import_node_crypto.createHash)("sha256").update(parsed.pathname).digest("hex");
    const existing = inVault ? await this.readVaultImage(stem) : await this.readCacheImage(stem);
    if (existing) return existing;
    const { bytes, contentType } = await downloadLinearAsset(this.app, this.secretName(), url);
    const extension = Object.keys(IMAGE_TYPES).find((ext) => IMAGE_TYPES[ext] === contentType);
    if (!extension) throw new LinearError(`Unsupported Linear image type: ${contentType || "unknown"}.`);
    const name = `${stem}.${extension}`;
    if (inVault) {
      const folder2 = this.vaultFolder();
      await this.ensureVaultFolder(folder2);
      const vaultPath = `${folder2}/${name}`;
      if (!this.app.vault.getAbstractFileByPath(vaultPath)) {
        try {
          await this.app.vault.createBinary(vaultPath, bytes);
        } catch (e) {
          if (!(this.app.vault.getAbstractFileByPath(vaultPath) instanceof import_obsidian2.TFile)) throw e;
        }
      }
      return { bytes, contentType, vaultPath };
    }
    const folder = this.cacheFolder();
    await import_node_fs.promises.mkdir(folder, { recursive: true, mode: 448 });
    await import_node_fs.promises.chmod(folder, 448);
    const temporary = (0, import_node_path.join)(folder, `${name}.${(0, import_node_crypto.randomUUID)()}.tmp`);
    try {
      await import_node_fs.promises.writeFile(temporary, Buffer.from(bytes), { flag: "wx", mode: 384 });
      try {
        await import_node_fs.promises.link(temporary, (0, import_node_path.join)(folder, name));
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
    } finally {
      await import_node_fs.promises.unlink(temporary).catch((e) => {
        if (e.code !== "ENOENT") {
          console.warn("[linear-spec-review] could not remove temporary image:", e);
        }
      });
    }
    return { bytes, contentType };
  }
  vaultFolder() {
    const folder = this.specsFolder().replace(/^\/+|\/+$/g, "") || "Specs";
    return (0, import_obsidian2.normalizePath)(`${folder}/_assets`);
  }
  cacheFolder() {
    if (!(this.app.vault.adapter instanceof import_obsidian2.FileSystemAdapter)) {
      throw new Error("Linear image caching requires a local desktop vault.");
    }
    const vaultId = (0, import_node_crypto.createHash)("sha256").update(this.app.vault.adapter.getBasePath()).digest("hex");
    return (0, import_node_path.join)((0, import_node_os.homedir)(), ".cache", "linear-spec-review", vaultId);
  }
  async readVaultImage(stem) {
    const folder = this.vaultFolder();
    for (const [ext, contentType] of Object.entries(IMAGE_TYPES)) {
      const vaultPath = `${folder}/${stem}.${ext}`;
      const file = this.app.vault.getAbstractFileByPath(vaultPath);
      if (file instanceof import_obsidian2.TFile) {
        return { bytes: await this.app.vault.readBinary(file), contentType, vaultPath };
      }
    }
    return null;
  }
  async readCacheImage(stem) {
    const folder = this.cacheFolder();
    for (const [ext, contentType] of Object.entries(IMAGE_TYPES)) {
      try {
        const bytes = await import_node_fs.promises.readFile((0, import_node_path.join)(folder, `${stem}.${ext}`));
        return {
          bytes: Uint8Array.from(bytes).buffer,
          contentType
        };
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    return null;
  }
  async ensureVaultFolder(path) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof import_obsidian2.TFolder) return;
    if (existing) throw new Error(`Cannot create asset folder: ${path} is a file.`);
    const parent = path.slice(0, path.lastIndexOf("/"));
    if (parent) await this.ensureVaultFolder(parent);
    try {
      await this.app.vault.createFolder(path);
    } catch (e) {
      if (!(this.app.vault.getAbstractFileByPath(path) instanceof import_obsidian2.TFolder)) throw e;
    }
  }
};

// src/render/assetPreview.ts
var import_obsidian3 = require("obsidian");
var AssetPreview = class {
  constructor(app, store, inVault) {
    this.app = app;
    this.store = store;
    this.inVault = inVault;
    this.objectUrls = /* @__PURE__ */ new Map();
    this.active = true;
    this.observer = new MutationObserver((changes) => {
      for (const change of changes) {
        if (change.type === "attributes") {
          this.checkImage(change.target);
        } else {
          change.addedNodes.forEach((node) => this.scan(node));
        }
      }
    });
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"]
    });
    this.scan(document.body);
  }
  stop() {
    this.active = false;
    this.observer.disconnect();
    document.querySelectorAll("img[data-lsr-asset-source]").forEach((img) => {
      img.src = img.dataset.lsrAssetSource ?? img.src;
      delete img.dataset.lsrAssetSource;
    });
    for (const pending of this.objectUrls.values()) {
      void pending.then((url) => URL.revokeObjectURL(url), () => {
      });
    }
    this.objectUrls.clear();
  }
  scan(node) {
    this.checkImage(node);
    if (node instanceof Element) {
      node.querySelectorAll("img").forEach((img) => this.checkImage(img));
    }
  }
  checkImage(node) {
    if (!(node instanceof HTMLImageElement)) return;
    if (node.dataset.lsrAssetSource) return;
    const src = node.getAttribute("src");
    if (!src?.startsWith("https://uploads.linear.app/")) return;
    if (!this.isLinearSpecImage(node)) return;
    node.dataset.lsrAssetSource = src;
    void this.getObjectUrl(src).then((url) => {
      if (this.active && node.isConnected && node.dataset.lsrAssetSource === src) {
        node.src = url;
      }
    }).catch((e) => {
      if (!this.active) return;
      const message = e instanceof Error ? e.message : String(e);
      console.error("[linear-spec-review] asset preview failed:", message);
      new import_obsidian3.Notice(`Linear image could not load: ${message}`);
    });
  }
  isLinearSpecImage(img) {
    const inComments = this.app.workspace.getLeavesOfType(LINEAR_COMMENTS_VIEW).some(
      (leaf) => leaf.view.containerEl.contains(img)
    );
    if (inComments) return true;
    let isSpec = false;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof import_obsidian3.MarkdownView) || !leaf.view.containerEl.contains(img)) return;
      const file = leaf.view.file;
      if (!file) return;
      isSpec = typeof this.app.metadataCache.getFileCache(file)?.frontmatter?.[FM_PROJECT_ID] === "string";
    });
    return isSpec;
  }
  getObjectUrl(src) {
    const key = `${this.inVault()}:${new URL(src).pathname}`;
    let pending = this.objectUrls.get(key);
    if (!pending) {
      pending = this.store.load(src, this.inVault()).then(
        ({ bytes, contentType }) => {
          if (!contentType.startsWith("image/")) {
            throw new Error(`Unexpected Linear image type: ${contentType || "unknown"}`);
          }
          return URL.createObjectURL(new Blob([bytes], { type: contentType }));
        }
      );
      this.objectUrls.set(key, pending);
    }
    return pending;
  }
};

// src/view/CommentsView.ts
var import_obsidian4 = require("obsidian");

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
function threadStatus(thread) {
  return thread.root.resolvedAt !== null ? "resolved" : "open";
}
function participantKey(comment) {
  if (comment.author !== null) {
    return `user:${comment.author.id}`;
  }
  if (comment.botActorName !== null) {
    return `bot:${comment.botActorName}`;
  }
  return "unknown:unknown";
}
function threadComments(thread) {
  return [thread.root, ...thread.replies];
}
function buildParticipantsList(threads) {
  const byKey = /* @__PURE__ */ new Map();
  for (const thread of threads) {
    const seenInThread = /* @__PURE__ */ new Set();
    for (const c of threadComments(thread)) {
      const key = participantKey(c);
      if (seenInThread.has(key)) {
        continue;
      }
      seenInThread.add(key);
      const existing = byKey.get(key);
      if (existing !== void 0) {
        existing.threadCount += 1;
      } else {
        byKey.set(key, {
          participant: { key, name: authorName(c) },
          threadCount: 1
        });
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => {
    if (b.threadCount !== a.threadCount) {
      return b.threadCount - a.threadCount;
    }
    return a.participant.name.localeCompare(b.participant.name);
  });
}
function formatTimestamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString();
}
function normalizeChar(ch) {
  switch (ch) {
    case "\u2018":
    // ‘
    case "\u2019":
    // ’
    case "\u201B":
      return "'";
    case "\u201C":
    // “
    case "\u201D":
    // ”
    case "\u201F":
      return '"';
    case "\u2013":
    // – en dash
    case "\u2014":
      return "-";
    case "\u2026":
      return ".";
    default:
      return ch;
  }
}
function buildStripped(raw) {
  let stripped = "";
  const rawOffsets = [];
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const ch = raw[i];
    if (ch === "`") {
      let j = i + 1;
      while (j < n && raw[j] === "`") {
        j++;
      }
      i = j;
      continue;
    }
    if (ch === "*" || ch === "_") {
      let j = i + 1;
      while (j < n && raw[j] === ch && j - i < 3) {
        j++;
      }
      i = j;
      continue;
    }
    if (ch === "\\" && i + 1 < n) {
      const next = normalizeChar(raw[i + 1]);
      stripped += next;
      rawOffsets.push(i);
      i += 2;
      continue;
    }
    stripped += normalizeChar(ch);
    rawOffsets.push(i);
    i++;
  }
  rawOffsets.push(n);
  return { stripped, rawOffsets };
}
function findAllInMarkdown(raw, needle) {
  if (needle.length === 0) {
    return [];
  }
  const verbatim = [];
  let searchFrom = 0;
  for (; ; ) {
    const at = raw.indexOf(needle, searchFrom);
    if (at === -1) {
      break;
    }
    verbatim.push({ from: at, to: at + needle.length });
    searchFrom = at + needle.length;
  }
  if (verbatim.length > 0) {
    return verbatim;
  }
  const { stripped, rawOffsets } = buildStripped(raw);
  let normalizedNeedle = "";
  for (const ch of needle) {
    normalizedNeedle += normalizeChar(ch);
  }
  if (normalizedNeedle.length === 0) {
    return [];
  }
  const matches = [];
  let strippedFrom = 0;
  for (; ; ) {
    const idx = stripped.indexOf(normalizedNeedle, strippedFrom);
    if (idx === -1) {
      break;
    }
    const from = rawOffsets[idx];
    const to = rawOffsets[idx + normalizedNeedle.length];
    if (from !== void 0 && to !== void 0) {
      matches.push({ from, to });
    }
    strippedFrom = idx + normalizedNeedle.length;
  }
  return matches;
}
function findAllInRenderedText(container, needle) {
  if (needle.length === 0) {
    return [];
  }
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes = [];
  const nodeStarts = [];
  let text = "";
  let node;
  while ((node = walker.nextNode()) !== null) {
    const textNode = node;
    nodeStarts.push(text.length);
    text += textNode.data;
    nodes.push(textNode);
  }
  function resolve(charIndex) {
    for (let i = 0; i < nodes.length; i++) {
      const start = nodeStarts[i];
      const len = nodes[i].data.length;
      if (charIndex <= start + len) {
        return { node: nodes[i], offset: charIndex - start };
      }
    }
    return null;
  }
  function rangeFor(from, to) {
    const start = resolve(from);
    const end = resolve(to);
    if (start === null || end === null) {
      return null;
    }
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  }
  function collect(haystack, term) {
    const ranges = [];
    let searchFrom = 0;
    for (; ; ) {
      const at = haystack.indexOf(term, searchFrom);
      if (at === -1) {
        break;
      }
      const range = rangeFor(at, at + term.length);
      if (range !== null) {
        ranges.push(range);
      }
      searchFrom = at + term.length;
    }
    return ranges;
  }
  const verbatim = collect(text, needle);
  if (verbatim.length > 0) {
    return verbatim;
  }
  let normalizedText = "";
  for (const ch of text) {
    normalizedText += normalizeChar(ch);
  }
  let normalizedNeedle = "";
  for (const ch of needle) {
    normalizedNeedle += normalizeChar(ch);
  }
  if (normalizedNeedle.length === 0) {
    return [];
  }
  return collect(normalizedText, normalizedNeedle);
}
async function waitForRenderedMatches(container, needle, timeoutMs = 800, intervalMs = 40) {
  const deadline = Date.now() + timeoutMs;
  let ranges = findAllInRenderedText(container, needle);
  while (ranges.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    ranges = findAllInRenderedText(container, needle);
  }
  return ranges;
}
function applyPreviewHighlight(range) {
  const mark = document.createElement("mark");
  mark.className = "lsr-preview-highlight";
  mark.appendChild(range.extractContents());
  range.insertNode(mark);
  return mark;
}
function clearPreviewHighlight(mark) {
  if (mark === null) {
    return;
  }
  const parent = mark.parentNode;
  if (parent === null) {
    return;
  }
  while (mark.firstChild !== null) {
    parent.insertBefore(mark.firstChild, mark);
  }
  parent.removeChild(mark);
  parent.normalize();
}
var CommentsView = class extends import_obsidian4.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.bodyEl = null;
    this.headerTitleEl = null;
    /**
     * Raw markdown of the active note captured at the last refresh. Occurrence
     * counts and click navigation both resolve against this snapshot so they stay
     * consistent between the rendered badges and clicks. Refreshed by `refresh()`.
     */
    this.noteContentSnapshot = null;
    /**
     * Next occurrence index to reveal for a given inline comment, keyed by comment
     * id. Advances (and wraps) on each click so repeated clicks cycle through all
     * matches. Reset whenever the body is re-rendered.
     */
    this.occurrenceIndex = /* @__PURE__ */ new Map();
    /**
     * The `<mark>` element currently highlighting a quoted-text match in the
     * note's Reading View (persistent, unlike Live Preview/Source mode which only
     * gets a transient CM6 selection). Null when nothing is highlighted or the
     * note isn't in Reading View. Cleared before applying a new highlight and on
     * `refresh()`.
     */
    this.activePreviewHighlight = null;
    /**
     * Watches the Reading View container for re-renders (Obsidian prunes/rebuilds
     * sections that scroll far out of view for large notes) and reapplies
     * `activePreviewHighlight` if it gets removed, so the highlight stays "live"
     * even after scrolling away and back. Disconnected before starting a new
     * highlight, on `refresh()`, and when the view closes.
     */
    this.activePreviewHighlightWatcher = null;
    // --- Filtering state (client-side; never triggers a re-fetch) ------------
    /** Threads last fetched from Linear, cached so filter toggles re-render locally. */
    this.lastThreads = null;
    /** Context for the cached threads (used by section renderers). */
    this.lastCtx = null;
    /** Container for the filter bar, rebuilt whenever filters or data change. */
    this.filterBarEl = null;
    /** Statuses currently hidden. Empty = show all. */
    this.excludedStatuses = /* @__PURE__ */ new Set();
    /**
     * Participant keys explicitly selected to filter by (opt-in). Empty = no
     * filter applied, show everyone's threads. Non-empty = only show threads
     * where at least one participant (root or reply author) is in this set.
     */
    this.includedPeople = /* @__PURE__ */ new Set();
    /** Project id the current filter state applies to; filters reset on change. */
    this.filterProjectId = null;
    /** Whether the people checklist is expanded. */
    this.peopleFilterExpanded = false;
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
    this.activePreviewHighlightWatcher?.disconnect();
    this.activePreviewHighlightWatcher = null;
    this.contentEl.empty();
  }
  /** Public entry point used by the plugin when the active leaf changes or via command. */
  async reload() {
    await this.refresh();
  }
  /** Build the persistent shell (header + filter bar + body container) once per open. */
  renderShell() {
    const root = this.contentEl;
    root.empty();
    root.addClass("lsr-comments-view");
    const sticky = root.createDiv({ cls: "lsr-sticky" });
    const header = sticky.createDiv({ cls: "lsr-header" });
    this.headerTitleEl = header.createDiv({ cls: "lsr-header-title" });
    const actions = header.createDiv({ cls: "lsr-header-actions" });
    const refreshBtn = actions.createEl("button", {
      cls: "lsr-btn lsr-refresh-btn",
      attr: { "aria-label": "Refresh", type: "button" }
    });
    (0, import_obsidian4.setIcon)(refreshBtn, "refresh-cw");
    refreshBtn.createSpan({ text: "Refresh" });
    refreshBtn.addEventListener("click", () => {
      void this.refresh();
    });
    const newBtn = actions.createEl("button", {
      cls: "lsr-btn lsr-new-comment-btn",
      attr: { "aria-label": "New comment", type: "button" }
    });
    (0, import_obsidian4.setIcon)(newBtn, "plus");
    newBtn.createSpan({ text: "New comment" });
    newBtn.addEventListener("click", () => {
      this.focusNewThreadComposer();
    });
    this.filterBarEl = sticky.createDiv({ cls: "lsr-filter-bar" });
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
    this.noteContentSnapshot = null;
    this.occurrenceIndex.clear();
    this.activePreviewHighlightWatcher?.disconnect();
    this.activePreviewHighlightWatcher = null;
    clearPreviewHighlight(this.activePreviewHighlight);
    this.activePreviewHighlight = null;
    this.lastThreads = null;
    this.lastCtx = null;
    this.clearFilterBar();
    const ctx = this.host.getActiveContext();
    this.setHeaderTitle(ctx !== null ? ctx.projectName : "No Linear note active");
    if (ctx === null) {
      body.createDiv({
        cls: "lsr-empty",
        text: "Open an imported Linear spec note to see its comments."
      });
      this.host.notifyCommentsLoaded(null);
      return;
    }
    if (this.filterProjectId !== ctx.projectId) {
      this.excludedStatuses.clear();
      this.includedPeople.clear();
      this.peopleFilterExpanded = false;
      this.filterProjectId = ctx.projectId;
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
      new import_obsidian4.Notice(msg);
      body.empty();
      body.createDiv({ cls: "lsr-error", text: msg });
      return;
    }
    body.empty();
    const activeFile = this.host.getActiveFile();
    if (activeFile !== null) {
      try {
        this.noteContentSnapshot = await this.host.app.vault.read(activeFile);
      } catch (e) {
        this.noteContentSnapshot = null;
        console.debug(
          "[linear-spec-review] note read for occurrence counts failed:",
          errorMessage(e)
        );
      }
    }
    this.lastThreads = this.groupComments(comments);
    this.lastCtx = ctx;
    this.renderFilterBar();
    this.renderFilteredBody();
    this.host.notifyCommentsLoaded(ctx.projectId);
  }
  setHeaderTitle(text) {
    if (this.headerTitleEl !== null) {
      this.headerTitleEl.setText(text);
    }
  }
  // --- Filtering -----------------------------------------------------------
  /** Empty the filter bar (used while loading / when there is no data). */
  clearFilterBar() {
    if (this.filterBarEl !== null) {
      this.filterBarEl.empty();
    }
  }
  /** All threads (inline + discussion) from the cached fetch. */
  allThreads() {
    if (this.lastThreads === null) {
      return [];
    }
    return [...this.lastThreads.inline, ...this.lastThreads.discussion];
  }
  /** True when the thread survives the current status + people filters. */
  threadPassesFilters(thread) {
    if (this.excludedStatuses.has(threadStatus(thread))) {
      return false;
    }
    if (this.includedPeople.size > 0) {
      const anyIncluded = threadComments(thread).some(
        (c) => this.includedPeople.has(participantKey(c))
      );
      if (!anyIncluded) {
        return false;
      }
    }
    return true;
  }
  isFilterActive() {
    return this.excludedStatuses.size > 0 || this.includedPeople.size > 0;
  }
  /** (Re)build the filter bar from the cached threads and current filter state. */
  renderFilterBar() {
    const bar = this.filterBarEl;
    if (bar === null) {
      return;
    }
    bar.empty();
    const threads = this.allThreads();
    if (threads.length === 0) {
      return;
    }
    const statusRow = bar.createDiv({ cls: "lsr-filter-row" });
    statusRow.createSpan({ cls: "lsr-filter-label", text: "Status" });
    const openCount = threads.filter((t) => threadStatus(t) === "open").length;
    const resolvedCount = threads.length - openCount;
    this.renderStatusChip(statusRow, "open", "Open", openCount);
    this.renderStatusChip(statusRow, "resolved", "Resolved", resolvedCount);
    const participants = buildParticipantsList(threads);
    if (participants.length > 0) {
      const peopleRow = bar.createDiv({ cls: "lsr-filter-row" });
      const toggle = peopleRow.createEl("button", {
        cls: "lsr-filter-people-toggle",
        attr: { type: "button" }
      });
      const selectedPeople = this.includedPeople.size;
      const label = selectedPeople > 0 ? `People (${selectedPeople} selected)` : `People (${participants.length})`;
      (0, import_obsidian4.setIcon)(toggle, this.peopleFilterExpanded ? "chevron-down" : "chevron-right");
      toggle.createSpan({ text: label });
      toggle.addEventListener("click", () => {
        this.peopleFilterExpanded = !this.peopleFilterExpanded;
        this.renderFilterBar();
      });
      if (this.peopleFilterExpanded) {
        const list = bar.createDiv({ cls: "lsr-people-list" });
        for (const { participant, threadCount } of participants) {
          this.renderPersonRow(list, participant, threadCount);
        }
      }
    }
    if (this.isFilterActive()) {
      const resetRow = bar.createDiv({ cls: "lsr-filter-row lsr-filter-reset-row" });
      const resetBtn = resetRow.createEl("button", {
        cls: "lsr-btn lsr-filter-reset",
        attr: { type: "button" }
      });
      (0, import_obsidian4.setIcon)(resetBtn, "x");
      resetBtn.createSpan({ text: "Clear filters" });
      resetBtn.addEventListener("click", () => {
        this.excludedStatuses.clear();
        this.includedPeople.clear();
        this.renderFilterBar();
        this.renderFilteredBody();
      });
    }
  }
  renderStatusChip(container, status, label, count) {
    const excluded = this.excludedStatuses.has(status);
    const chip = container.createEl("button", {
      cls: `lsr-filter-chip${excluded ? "" : " is-active"}`,
      attr: {
        type: "button",
        "aria-pressed": excluded ? "false" : "true"
      }
    });
    chip.createSpan({ text: label });
    chip.createSpan({ cls: "lsr-filter-chip-count", text: String(count) });
    chip.addEventListener("click", () => {
      if (excluded) {
        this.excludedStatuses.delete(status);
      } else {
        this.excludedStatuses.add(status);
      }
      this.renderFilterBar();
      this.renderFilteredBody();
    });
  }
  renderPersonRow(container, participant, threadCount) {
    const selected = this.includedPeople.has(participant.key);
    const row = container.createEl("label", { cls: "lsr-person-row" });
    const checkbox = row.createEl("input", {
      attr: { type: "checkbox" }
    });
    checkbox.checked = selected;
    row.createSpan({ cls: "lsr-person-name", text: participant.name });
    row.createSpan({ cls: "lsr-person-count", text: String(threadCount) });
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        this.includedPeople.add(participant.key);
      } else {
        this.includedPeople.delete(participant.key);
      }
      this.renderFilterBar();
      this.renderFilteredBody();
    });
  }
  /** Render the body sections from cached threads, applying current filters. */
  renderFilteredBody() {
    const body = this.bodyEl;
    const ctx = this.lastCtx;
    if (body === null || ctx === null || this.lastThreads === null) {
      return;
    }
    body.empty();
    this.occurrenceIndex.clear();
    const inline = this.lastThreads.inline.filter(
      (t) => this.threadPassesFilters(t)
    );
    const discussion = this.lastThreads.discussion.filter(
      (t) => this.threadPassesFilters(t)
    );
    const totalThreads = this.allThreads().length;
    const visibleThreads = inline.length + discussion.length;
    if (this.isFilterActive() && totalThreads > 0 && visibleThreads === 0) {
      body.createDiv({
        cls: "lsr-empty",
        text: `No comments match the current filters (${totalThreads} hidden).`
      });
    }
    this.renderInlineSection(body, inline, ctx, this.noteContentSnapshot);
    this.renderDiscussionSection(body, discussion, ctx);
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
  renderInlineSection(container, threads, ctx, content) {
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
        const quotedEl = threadEl.createDiv({
          cls: "lsr-quoted lsr-quoted-clickable"
        });
        quotedEl.createSpan({ cls: "lsr-quoted-text", text: quoted });
        const occurrences = content !== null ? findAllInMarkdown(content, quoted).length : 0;
        let badgeEl = null;
        if (occurrences > 1) {
          badgeEl = quotedEl.createSpan({
            cls: "lsr-occurrence-badge",
            text: `1 / ${occurrences}`
          });
          quotedEl.setAttr(
            "title",
            "Click to jump to this text; click again for the next occurrence"
          );
        } else {
          quotedEl.setAttr("title", "Click to jump to this text in the note");
        }
        const commentId = thread.root.id;
        quotedEl.addEventListener("click", () => {
          void this.scrollEditorToQuotedText(quoted, commentId, badgeEl);
        });
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
    void import_obsidian4.MarkdownRenderer.render(
      this.host.app,
      comment.body,
      bodyEl,
      "",
      this
    ).catch((e) => {
      bodyEl.setText(comment.body);
      new import_obsidian4.Notice(`Failed to render comment: ${errorMessage(e)}`);
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
      new import_obsidian4.Notice("Reply cannot be empty.");
      return;
    }
    button.disabled = true;
    textarea.disabled = true;
    try {
      const reply = await replyToThread(
        this.host.app,
        this.host.getSecretName(),
        ctx.documentContentId,
        parentId,
        body
      );
      new import_obsidian4.Notice("Reply posted.");
      this.patchReplyIntoCache(parentId, reply);
    } catch (e) {
      new import_obsidian4.Notice(errorMessage(e));
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
      new import_obsidian4.Notice("Comment cannot be empty.");
      return;
    }
    button.disabled = true;
    textarea.disabled = true;
    try {
      const created = await createThread(
        this.host.app,
        this.host.getSecretName(),
        ctx.documentContentId,
        body
      );
      new import_obsidian4.Notice("Comment posted.");
      this.patchNewThreadIntoCache(created);
    } catch (e) {
      new import_obsidian4.Notice(errorMessage(e));
      button.disabled = false;
      textarea.disabled = false;
    }
  }
  /**
   * Insert a freshly-posted reply into the cached thread list and re-render
   * locally, instead of re-fetching every comment from Linear. The mutation
   * already returns the fully-mapped comment, so there is nothing left to
   * fetch. Falls back to a full `refresh()` if the parent thread cannot be
   * found in the cache (should not normally happen).
   */
  patchReplyIntoCache(parentId, reply) {
    if (this.lastThreads === null) {
      void this.refresh();
      return;
    }
    const thread = this.allThreads().find((t) => t.root.id === parentId);
    if (thread === void 0) {
      void this.refresh();
      return;
    }
    thread.replies.push(reply);
    thread.replies.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this.renderFilterBar();
    this.renderFilteredBody();
  }
  /**
   * Insert a freshly-posted top-level thread into the cached discussion list
   * and re-render locally (see {@link patchReplyIntoCache}). The new-thread
   * composer never sets `quotedText`, so this always creates a discussion
   * thread; new threads are sorted newest-first, so it is unshifted to match.
   */
  patchNewThreadIntoCache(created) {
    if (this.lastThreads === null) {
      void this.refresh();
      return;
    }
    const thread = {
      root: created,
      replies: [],
      isInline: created.quotedText !== null
    };
    this.lastThreads.discussion.unshift(thread);
    this.renderFilterBar();
    this.renderFilteredBody();
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
      new import_obsidian4.Notice("Open a Linear spec note to add a comment.");
    }
  }
  /**
   * Locate an inline comment's `quotedText` in the active note and reveal it in
   * the editor: select the matched range and scroll it into view.
   *
   * When the snippet occurs multiple times, repeated clicks cycle through each
   * occurrence (wrapping around), advancing `occurrenceIndex` per comment and
   * updating the `x / N` badge. Matches resolve against `noteContentSnapshot`
   * (captured at the last refresh) so the count shown on the badge and the
   * navigation stay consistent; if no snapshot exists it reads once as a
   * fallback.
   *
   * All editor interaction goes through Obsidian's stable `Editor` API — no CM6
   * internals.
   */
  async scrollEditorToQuotedText(quoted, commentId, badgeEl) {
    const file = this.host.getActiveFile();
    if (file === null) {
      new import_obsidian4.Notice("Open the Linear spec note to jump to quoted text.");
      return;
    }
    const workspace = this.host.app.workspace;
    const mdLeaf = workspace.getLeavesOfType("markdown").find((leaf) => {
      const view2 = leaf.view;
      return view2 instanceof import_obsidian4.MarkdownView && view2.file?.path === file.path;
    });
    if (mdLeaf === void 0 || !(mdLeaf.view instanceof import_obsidian4.MarkdownView)) {
      new import_obsidian4.Notice("Open the Linear spec note in a pane to jump to quoted text.");
      return;
    }
    const view = mdLeaf.view;
    let content = this.noteContentSnapshot;
    if (content === null) {
      try {
        content = await this.host.app.vault.read(file);
      } catch (e) {
        new import_obsidian4.Notice(`Could not read the note: ${errorMessage(e)}`);
        return;
      }
    }
    const matches = findAllInMarkdown(content, quoted);
    if (matches.length === 0) {
      new import_obsidian4.Notice("Could not locate the quoted text in this note.");
      return;
    }
    const total = matches.length;
    const current = this.occurrenceIndex.get(commentId) ?? 0;
    const index = current % total;
    this.occurrenceIndex.set(commentId, (index + 1) % total);
    if (badgeEl !== null) {
      badgeEl.setText(`${index + 1} / ${total}`);
    }
    const match = matches[index];
    const fromPos = offsetToPosition(content, match.from);
    const toPos = offsetToPosition(content, match.to);
    this.host.app.workspace.setActiveLeaf(mdLeaf, { focus: true });
    if (view.getMode() !== "source") {
      const previewScrolled = this.scrollPreviewToLine(view, fromPos.line);
      await this.applyReadingViewHighlight(view, quoted, index);
      if (!previewScrolled) {
        new import_obsidian4.Notice(
          "Switch the note to editing view to jump to the quoted text."
        );
      }
      return;
    }
    const editor = view.editor;
    try {
      editor.setSelection(fromPos, toPos);
      editor.scrollIntoView({ from: fromPos, to: toPos }, true);
    } catch (e) {
      console.debug(
        "[linear-spec-review] editor reveal raised (non-fatal):",
        errorMessage(e)
      );
    }
  }
  /**
   * Scroll a markdown view's rendered preview (reading mode) to a line.
   *
   * Obsidian's reading view has no `Editor`, but `MarkdownView.setEphemeralState`
   * accepts a `{ line }` and scrolls the preview to it — the same mechanism used
   * when following a link into a note. Returns false if the API is unavailable.
   */
  scrollPreviewToLine(view, line) {
    try {
      view.setEphemeralState({ line });
      return true;
    } catch (e) {
      console.debug(
        "[linear-spec-review] preview scroll raised (non-fatal):",
        errorMessage(e)
      );
      return false;
    }
  }
  /**
   * Persistently highlight the exact occurrence of `quoted` in the note's
   * Reading View. Clears any previous highlight first so only one is ever
   * active. Best-effort: if the rendered text doesn't yield the expected
   * occurrence (e.g. a rare mismatch between raw-markdown and rendered-text
   * matching), this silently no-ops — the scroll-to-line still succeeded.
   *
   * Reading View incrementally (re)renders only a window of the document
   * around the current scroll position for larger notes — it is not fully
   * static — so the target text may not exist in the DOM yet immediately
   * after triggering the scroll. This polls briefly for it to appear.
   */
  async applyReadingViewHighlight(view, quoted, occurrenceIndex) {
    this.activePreviewHighlightWatcher?.disconnect();
    this.activePreviewHighlightWatcher = null;
    clearPreviewHighlight(this.activePreviewHighlight);
    this.activePreviewHighlight = null;
    const container = view.previewMode?.containerEl;
    if (container === void 0) {
      return;
    }
    try {
      const ranges = await waitForRenderedMatches(container, quoted);
      const range = ranges[occurrenceIndex] ?? ranges[0];
      if (range === void 0) {
        return;
      }
      this.activePreviewHighlight = applyPreviewHighlight(range);
      this.watchPreviewHighlight(container, quoted, occurrenceIndex);
    } catch (e) {
      console.debug(
        "[linear-spec-review] preview highlight raised (non-fatal):",
        errorMessage(e)
      );
    }
  }
  /**
   * Reapply the highlight if Obsidian's Reading View prunes/rebuilds the
   * section it lives in (this happens when the user scrolls far enough away
   * and back, for large notes — see {@link waitForRenderedMatches}). Without
   * this, the highlight would only survive until the next such re-render.
   */
  watchPreviewHighlight(container, quoted, occurrenceIndex) {
    const observer = new MutationObserver(() => {
      if (this.activePreviewHighlight?.isConnected === true) {
        return;
      }
      const ranges = findAllInRenderedText(container, quoted);
      const range = ranges[occurrenceIndex] ?? ranges[0];
      if (range === void 0) {
        return;
      }
      this.activePreviewHighlight = applyPreviewHighlight(range);
    });
    observer.observe(container, { childList: true, subtree: true });
    this.activePreviewHighlightWatcher = observer;
  }
};
function offsetToPosition(content, offset) {
  const clamped = Math.max(0, Math.min(offset, content.length));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (content[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, ch: clamped - lineStart };
}

// src/settings.ts
var import_obsidian5 = require("obsidian");
function errorMessage2(e) {
  return e instanceof Error ? e.message : String(e);
}
var LinearSettingTab = class extends import_obsidian5.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  /** Persist settings, surfacing any failure to the user via a Notice. */
  async persist() {
    try {
      await this.plugin.saveSettings();
    } catch (e) {
      new import_obsidian5.Notice(`Failed to save settings: ${errorMessage2(e)}`);
    }
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const secretStorage = this.app.secretStorage;
    if (typeof import_obsidian5.SecretComponent === "undefined" || !secretStorage) {
      containerEl.createEl("p", {
        cls: "lsr-settings-error",
        text: "This plugin requires Obsidian Secret Storage, which is unavailable. Update Obsidian."
      });
      return;
    }
    new import_obsidian5.Setting(containerEl).setName("Linear API key").setDesc(
      "Select or create a secret in Obsidian Secret Storage that holds your Linear personal API key."
    ).addComponent(
      (el) => new import_obsidian5.SecretComponent(this.app, el).setValue(this.plugin.settings.secretName).onChange(async (value) => {
        this.plugin.settings.secretName = value;
        this.plugin.updateAssetPreview();
        await this.persist();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Specs folder").setDesc("Vault-relative folder where imported specs are written.").addText(
      (text) => text.setPlaceholder("Specs").setValue(this.plugin.settings.specsFolder).onChange(async (value) => {
        const trimmed = value.trim();
        this.plugin.settings.specsFolder = trimmed.length > 0 ? trimmed : "Specs";
        await this.persist();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Save Linear images in vault").setDesc("Off: cache images outside the vault (default). On: save images under the specs folder; re-import a spec to make its Markdown point to the saved images. Comments use the same storage choice.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.storeAssetsInVault).onChange(async (enabled) => {
        this.plugin.settings.storeAssetsInVault = enabled;
        this.plugin.updateAssetPreview();
        await this.persist();
      })
    );
  }
};

// src/commands.ts
var import_obsidian6 = require("obsidian");
var import_node_path2 = require("node:path");

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
var UPLOAD_EMBED = /(!\[[^\]\n]*\]\()(https:\/\/uploads\.linear\.app\/[^\s)]+)(\))/g;
function embeddedLinearImages(md) {
  return [...new Set([...md.matchAll(UPLOAD_EMBED)].map((match) => match[2]))];
}
function linkLocalImages(md, paths) {
  return md.replace(UPLOAD_EMBED, (original, prefix, url, suffix) => {
    const path = paths.get(url);
    return path ? `${prefix}${encodeURI(path)}${suffix}` : original;
  });
}

// src/commands.ts
function errorMessage3(e) {
  return e instanceof Error ? e.message : String(e);
}
var ImportUrlModal = class extends import_obsidian6.Modal {
  constructor(app, onSubmit) {
    super(app);
    this.url = "";
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Import Linear project by URL" });
    new import_obsidian6.Setting(contentEl).setName("Project URL").addText((text) => {
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
    new import_obsidian6.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("Import").setCta().onClick(() => this.submit())
    );
  }
  submit() {
    const value = this.url.trim();
    if (value.length === 0) {
      new import_obsidian6.Notice("Please paste a Linear project URL.");
      return;
    }
    this.close();
    this.onSubmit(value);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ProjectSuggestModal = class extends import_obsidian6.FuzzySuggestModal {
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
      new import_obsidian6.Notice(errorMessage3(e));
      this.items = [];
    }
    this.updateSuggestions?.();
  }
};
async function writeProjectNote(host, project) {
  const app = host.app;
  const folder = host.getSpecsFolder().replace(/^\/+|\/+$/g, "") || "Specs";
  const base = sanitizeFileName(project.name) || project.slugId;
  const path = (0, import_obsidian6.normalizePath)(`${folder}/${base}.md`);
  const folderPath = (0, import_obsidian6.normalizePath)(folder);
  if (folder.length > 0 && app.vault.getAbstractFileByPath(folderPath) === null) {
    await app.vault.createFolder(folderPath).catch(() => {
    });
  }
  let content = buildNote(project);
  if (host.storeAssetsInVault()) {
    const paths = /* @__PURE__ */ new Map();
    for (const url of embeddedLinearImages(content)) {
      const assetPath = await host.saveEmbeddedImage(url);
      paths.set(url, import_node_path2.posix.relative(import_node_path2.posix.dirname(path), assetPath));
    }
    content = linkLocalImages(content, paths);
  }
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof import_obsidian6.TFile) {
    await app.vault.modify(existing, content);
    return existing;
  }
  return await app.vault.create(path, content);
}
async function importByUrl(host, url) {
  const secretName = host.getSecretName();
  try {
    new import_obsidian6.Notice("Resolving Linear project\u2026");
    const match = await resolveProjectFromUrl(
      host.app,
      secretName,
      url
    );
    const project = await getProjectById(host.app, secretName, match.id);
    const file = await writeProjectNote(host, project);
    await host.app.workspace.getLeaf(false).openFile(file);
    await host.onImported(file);
    new import_obsidian6.Notice(`Imported "${project.name}".`);
  } catch (e) {
    new import_obsidian6.Notice(errorMessage3(e));
  }
}
async function importByProject(host, projectId) {
  const secretName = host.getSecretName();
  try {
    const project = await getProjectById(host.app, secretName, projectId);
    const file = await writeProjectNote(host, project);
    await host.app.workspace.getLeaf(false).openFile(file);
    await host.onImported(file);
    new import_obsidian6.Notice(`Imported "${project.name}".`);
  } catch (e) {
    new import_obsidian6.Notice(errorMessage3(e));
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
var LinearSpecReviewPlugin = class extends import_obsidian7.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    /**
     * Project id the comments panel last loaded for. Used to avoid re-fetching
     * comments on every `active-leaf-change` (e.g. focusing out and clicking back
     * into the panel). We only reload when the active note's project actually
     * changes; manual Refresh remains the explicit way to re-fetch the same note.
     */
    this.lastLoadedProjectId = null;
    this.assetPreview = null;
    this.assetStore = null;
  }
  async onload() {
    await this.loadSettings();
    try {
      assertSecretStorage(this.app);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new import_obsidian7.Notice(`Linear Spec Review: ${msg}`);
      console.error("[linear-spec-review]", msg);
    }
    this.registerView(
      LINEAR_COMMENTS_VIEW,
      (leaf) => new CommentsView(leaf, this)
    );
    this.addSettingTab(new LinearSettingTab(this.app, this));
    this.assetStore = new AssetStore(this.app, () => this.getSecretName(), () => this.getSpecsFolder());
    this.updateAssetPreview();
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
        void this.syncCommentsViewOnLeafChange();
      })
    );
  }
  onunload() {
    this.assetPreview?.stop();
    this.assetPreview = null;
  }
  updateAssetPreview() {
    this.assetPreview?.stop();
    this.assetPreview = this.assetStore ? new AssetPreview(this.app, this.assetStore, () => this.settings.storeAssetsInVault) : null;
  }
  storeAssetsInVault() {
    return this.settings.storeAssetsInVault;
  }
  async saveEmbeddedImage(url) {
    if (!this.assetStore) throw new Error("Linear image store is unavailable.");
    const image = await this.assetStore.load(url, true);
    if (!image.vaultPath) throw new Error("Linear image was not saved in the vault.");
    return image.vaultPath;
  }
  // --- Settings persistence -------------------------------------------------
  async loadSettings() {
    const data = await this.loadData();
    this.settings = {
      secretName: typeof data?.secretName === "string" ? data.secretName : DEFAULT_SETTINGS.secretName,
      specsFolder: typeof data?.specsFolder === "string" ? data.specsFolder : DEFAULT_SETTINGS.specsFolder,
      storeAssetsInVault: data?.storeAssetsInVault === true
    };
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
  /** The active markdown note file, or null when no markdown file is active. */
  getActiveFile() {
    const file = this.app.workspace.getActiveFile();
    if (file === null || file.extension !== "md") {
      return null;
    }
    return file;
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
      new import_obsidian7.Notice("Could not open the comments panel (no right sidebar).");
      return;
    }
    await leaf.setViewState({ type: LINEAR_COMMENTS_VIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  /**
   * Reload the panel on `active-leaf-change`, but only when the active note's
   * Linear project differs from what the panel last loaded. This prevents a
   * live re-fetch every time focus moves (e.g. clicking back into the panel).
   *
   * The active-leaf context is only considered when the active leaf is an
   * actual note, so focusing the panel itself (which reports no active file)
   * never clears or reloads the currently displayed comments.
   */
  async syncCommentsViewOnLeafChange() {
    if (this.app.workspace.getLeavesOfType(LINEAR_COMMENTS_VIEW).length === 0) {
      return;
    }
    const ctx = this.getActiveContext();
    if (ctx === null) {
      return;
    }
    if (ctx.projectId === this.lastLoadedProjectId) {
      return;
    }
    await this.refreshCommentsView();
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
  /**
   * Called by the comments view whenever it finishes (re)loading, reporting the
   * project id it now reflects. Recorded so leaf-change syncs can skip reloads
   * when the active note's project is already displayed.
   */
  notifyCommentsLoaded(projectId) {
    this.lastLoadedProjectId = projectId;
  }
};
