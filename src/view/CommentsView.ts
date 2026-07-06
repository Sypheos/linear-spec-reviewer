import {
  ItemView,
  WorkspaceLeaf,
  MarkdownRenderer,
  Notice,
  Component,
  setIcon,
} from "obsidian";
import {
  LinearComment,
  CommentThread,
  GroupedComments,
  LINEAR_COMMENTS_VIEW,
} from "../types";
import {
  getProjectComments,
  createThread,
  replyToThread,
} from "../linear/queries";

/**
 * Contract the concrete plugin must satisfy so the view never imports the
 * plugin class directly (avoids a circular dependency).
 */
export interface CommentsHost {
  app: import("obsidian").App;
  getSecretName(): string;
  /** Returns the active note's linear context, or null if the active file is not a linear-linked note. */
  getActiveContext(): {
    projectId: string;
    documentContentId: string;
    projectName: string;
  } | null;
}

/** Extract a human message from an unknown thrown value. */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Best display name for a comment's author. */
function authorName(comment: LinearComment): string {
  return comment.author?.name ?? comment.botActorName ?? "Unknown";
}

/** Human-ish timestamp for a comment. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString();
}

export class CommentsView extends ItemView {
  private readonly host: CommentsHost;
  private bodyEl: HTMLElement | null = null;
  private headerTitleEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: CommentsHost) {
    super(leaf);
    this.host = plugin;
  }

  getViewType(): string {
    return LINEAR_COMMENTS_VIEW;
  }

  getDisplayText(): string {
    return "Linear comments";
  }

  getIcon(): string {
    return "message-square";
  }

  async onOpen(): Promise<void> {
    this.renderShell();
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Public entry point used by the plugin when the active leaf changes or via command. */
  async reload(): Promise<void> {
    await this.refresh();
  }

  /** Build the persistent shell (header + body container) once per open. */
  private renderShell(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("lsr-comments-view");

    const header = root.createDiv({ cls: "lsr-header" });
    this.headerTitleEl = header.createDiv({ cls: "lsr-header-title" });

    const actions = header.createDiv({ cls: "lsr-header-actions" });

    const refreshBtn = actions.createEl("button", {
      cls: "lsr-btn lsr-refresh-btn",
      attr: { "aria-label": "Refresh", type: "button" },
    });
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.createSpan({ text: "Refresh" });
    refreshBtn.addEventListener("click", () => {
      void this.refresh();
    });

    const newBtn = actions.createEl("button", {
      cls: "lsr-btn lsr-new-comment-btn",
      attr: { "aria-label": "New comment", type: "button" },
    });
    setIcon(newBtn, "plus");
    newBtn.createSpan({ text: "New comment" });
    newBtn.addEventListener("click", () => {
      this.focusNewThreadComposer();
    });

    this.bodyEl = root.createDiv({ cls: "lsr-body" });
  }

  /** Reload comments live from Linear and re-render the body. */
  async refresh(): Promise<void> {
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
        text: "Open an imported Linear spec note to see its comments.",
      });
      return;
    }

    const secretName = this.host.getSecretName();
    body.createDiv({ cls: "lsr-loading", text: "Loading comments…" });

    let comments: LinearComment[];
    try {
      comments = await getProjectComments(
        this.host.app,
        secretName,
        ctx.projectId
      );
    } catch (e) {
      const msg = errorMessage(e);
      new Notice(msg);
      body.empty();
      body.createDiv({ cls: "lsr-error", text: msg });
      return;
    }

    body.empty();
    const grouped = this.groupComments(comments);
    this.renderInlineSection(body, grouped.inline, ctx);
    this.renderDiscussionSection(body, grouped.discussion, ctx);
  }

  private setHeaderTitle(text: string): void {
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
  private groupComments(comments: LinearComment[]): GroupedComments {
    const byId = new Map<string, LinearComment>();
    for (const c of comments) {
      byId.set(c.id, c);
    }

    const threads = new Map<string, CommentThread>();

    // Seed roots first so replies can attach in a single subsequent pass.
    for (const c of comments) {
      const isRoot = c.parentId === null || !byId.has(c.parentId);
      if (isRoot) {
        threads.set(c.id, {
          root: c,
          replies: [],
          isInline: c.quotedText !== null,
        });
      }
    }

    for (const c of comments) {
      if (c.parentId === null) {
        continue;
      }
      const parentThread = threads.get(c.parentId);
      if (parentThread === undefined) {
        // Parent exists in the set but is itself a reply, or the root was
        // already claimed; if we somehow have no thread, promote defensively.
        if (!threads.has(c.id)) {
          threads.set(c.id, {
            root: c,
            replies: [],
            isInline: c.quotedText !== null,
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

    const inline: CommentThread[] = [];
    const discussion: CommentThread[] = [];
    for (const t of all) {
      if (t.isInline) {
        inline.push(t);
      } else {
        discussion.push(t);
      }
    }

    return { inline, discussion };
  }

  private renderInlineSection(
    container: HTMLElement,
    threads: CommentThread[],
    ctx: { projectId: string; documentContentId: string; projectName: string }
  ): void {
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

  private renderDiscussionSection(
    container: HTMLElement,
    threads: CommentThread[],
    ctx: { projectId: string; documentContentId: string; projectName: string }
  ): void {
    const section = container.createDiv({
      cls: "lsr-section lsr-discussion-section",
    });
    section.createEl("h3", { cls: "lsr-section-title", text: "Discussion" });

    this.renderNewThreadComposer(section, ctx);

    if (threads.length === 0) {
      section.createDiv({ cls: "lsr-empty", text: "No discussion comments." });
      return;
    }

    for (const thread of threads) {
      const threadEl = section.createDiv({
        cls: "lsr-thread lsr-discussion-thread",
      });
      this.renderThreadBodies(threadEl, thread, ctx);
    }
  }

  /** Render the root comment, its replies, resolved badge, and reply box. */
  private renderThreadBodies(
    threadEl: HTMLElement,
    thread: CommentThread,
    ctx: { projectId: string; documentContentId: string; projectName: string }
  ): void {
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
  private renderComment(
    container: HTMLElement,
    comment: LinearComment,
    showResolved: boolean
  ): void {
    const commentEl = container.createDiv({ cls: "lsr-comment" });

    const meta = commentEl.createDiv({ cls: "lsr-comment-meta" });
    meta.createSpan({ cls: "lsr-comment-author", text: authorName(comment) });
    meta.createSpan({
      cls: "lsr-comment-time",
      text: formatTimestamp(comment.createdAt),
    });
    if (showResolved) {
      meta.createSpan({ cls: "lsr-resolved-badge", text: "Resolved" });
    }

    const bodyEl = commentEl.createDiv({ cls: "lsr-comment-body" });
    // MarkdownRenderer.render(app, markdown, el, sourcePath, component).
    // Pass `this` (an ItemView, which is a Component) so child components are
    // unloaded when the view is unloaded.
    void MarkdownRenderer.render(
      this.host.app,
      comment.body,
      bodyEl,
      "",
      this as Component
    ).catch((e: unknown) => {
      bodyEl.setText(comment.body);
      new Notice(`Failed to render comment: ${errorMessage(e)}`);
    });
  }

  /** Render the reply composer for a thread. */
  private renderReplyBox(
    threadEl: HTMLElement,
    parentId: string,
    ctx: { projectId: string; documentContentId: string; projectName: string }
  ): void {
    const box = threadEl.createDiv({ cls: "lsr-reply-box" });
    const textarea = box.createEl("textarea", {
      cls: "lsr-reply-input",
      attr: { placeholder: "Reply…", rows: "2" },
    });
    const button = box.createEl("button", {
      cls: "lsr-btn lsr-reply-btn",
      text: "Reply",
      attr: { type: "button" },
    });

    button.addEventListener("click", () => {
      void this.submitReply(textarea, button, parentId, ctx);
    });
  }

  private async submitReply(
    textarea: HTMLTextAreaElement,
    button: HTMLButtonElement,
    parentId: string,
    ctx: { projectId: string; documentContentId: string; projectName: string }
  ): Promise<void> {
    const body = textarea.value.trim();
    if (body.length === 0) {
      new Notice("Reply cannot be empty.");
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
      new Notice("Reply posted.");
      await this.refresh();
    } catch (e) {
      new Notice(errorMessage(e));
      button.disabled = false;
      textarea.disabled = false;
    }
  }

  /** Render the top-of-discussion composer for creating a brand-new thread. */
  private renderNewThreadComposer(
    container: HTMLElement,
    ctx: { projectId: string; documentContentId: string; projectName: string }
  ): void {
    const box = container.createDiv({ cls: "lsr-reply-box lsr-new-thread-box" });
    const textarea = box.createEl("textarea", {
      cls: "lsr-reply-input lsr-new-thread-input",
      attr: { placeholder: "Start a new discussion…", rows: "3" },
    });
    const button = box.createEl("button", {
      cls: "lsr-btn lsr-new-thread-btn",
      text: "New thread",
      attr: { type: "button" },
    });

    button.addEventListener("click", () => {
      void this.submitNewThread(textarea, button, ctx);
    });
  }

  private async submitNewThread(
    textarea: HTMLTextAreaElement,
    button: HTMLButtonElement,
    ctx: { projectId: string; documentContentId: string; projectName: string }
  ): Promise<void> {
    const body = textarea.value.trim();
    if (body.length === 0) {
      new Notice("Comment cannot be empty.");
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
      new Notice("Comment posted.");
      await this.refresh();
    } catch (e) {
      new Notice(errorMessage(e));
      button.disabled = false;
      textarea.disabled = false;
    }
  }

  /** Scroll to and focus the new-thread composer (used by the header button). */
  private focusNewThreadComposer(): void {
    if (this.bodyEl === null) {
      return;
    }
    const input = this.bodyEl.querySelector<HTMLTextAreaElement>(
      ".lsr-new-thread-input"
    );
    if (input !== null) {
      input.scrollIntoView({ block: "center" });
      input.focus();
    } else {
      new Notice("Open a Linear spec note to add a comment.");
    }
  }
}
