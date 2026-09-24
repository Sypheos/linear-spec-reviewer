import { App, MarkdownView } from "obsidian";
import { StoredImage } from "../linear/assets";
import { figmaFrameKey } from "../linear/figma";
import { FM_PROJECT_ID, LINEAR_COMMENTS_VIEW } from "../types";

export interface FigmaPreviewHost {
  app: App;
  getFigmaScreenshots(projectId: string): Promise<Map<string, string>>;
  loadFigmaScreenshot(url: string): Promise<StoredImage>;
}

/** Show Linear's screenshots beside Figma links, without contacting Figma. */
export class FigmaPreview {
  private readonly observer: MutationObserver;
  private readonly projects = new Map<string, Promise<Map<string, string>>>();
  private readonly objectUrls = new Map<HTMLAnchorElement, string>();
  private readonly waiting: Array<() => void> = [];
  private runningImages = 0;
  private active = true;

  constructor(private readonly host: FigmaPreviewHost) {
    this.observer = new MutationObserver((changes) => {
      for (const change of changes) {
        if (change.type === "attributes") {
          this.scan(change.target);
        } else {
          change.addedNodes.forEach((node) => this.scan(node));
        }
      }
      this.releaseDetachedImages();
    });
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-lsr-figma-screenshot"],
    });
    this.scan(document.body);
  }

  stop(): void {
    this.active = false;
    this.observer.disconnect();
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    document.querySelectorAll(".lsr-figma-preview").forEach((el) => el.remove());
    document.querySelectorAll<HTMLAnchorElement>("a[data-lsr-figma-preview]").forEach((link) => {
      delete link.dataset.lsrFigmaPreview;
    });
  }

  private scan(node: Node): void {
    if (node instanceof HTMLAnchorElement) this.addPreview(node);
    if (node instanceof Element) {
      node.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((link) => this.addPreview(link));
    }
  }

  private addPreview(link: HTMLAnchorElement): void {
    if (link.dataset.lsrFigmaPreview) return;
    const key = figmaFrameKey(link.href);
    if (!key) return;
    const screenshot = this.commentScreenshot(link);
    const projectId = screenshot ? null : this.projectForLink(link);
    if (!screenshot && !projectId) return;

    const preview = document.createElement("span");
    preview.className = "lsr-figma-preview";
    preview.textContent = "Loading design…";
    link.dataset.lsrFigmaPreview = "true";
    link.insertAdjacentElement("afterend", preview);
    void this.show(link, preview, key, screenshot, projectId);
  }

  private commentScreenshot(link: HTMLAnchorElement): string | null {
    if (!link.closest(".lsr-comment-body")) return null;
    const inPanel = this.host.app.workspace.getLeavesOfType(LINEAR_COMMENTS_VIEW).some(
      (leaf) => leaf.view.containerEl.contains(link)
    );
    return inPanel ? link.dataset.lsrFigmaScreenshot ?? null : null;
  }

  private projectForLink(link: HTMLAnchorElement): string | null {
    if (!link.closest(".markdown-preview-view")) return null;
    let projectId: string | null = null;
    this.host.app.workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof MarkdownView) || !leaf.view.containerEl.contains(link)) return;
      const file = leaf.view.file;
      if (!file) return;
      const id = this.host.app.metadataCache.getFileCache(file)?.frontmatter?.[FM_PROJECT_ID];
      if (typeof id === "string") projectId = id;
    });
    return projectId;
  }

  private async show(
    link: HTMLAnchorElement,
    preview: HTMLSpanElement,
    key: string,
    commentScreenshot: string | null,
    projectId: string | null
  ): Promise<void> {
    try {
      const screenshots = projectId ? await this.screenshotsForProject(projectId) : null;
      const url = commentScreenshot ?? screenshots?.get(key);
      if (!url) throw new Error("No screenshot in Linear");
      const image = await this.loadImage(url);
      if (!this.active || !link.isConnected) return;

      const objectUrl = URL.createObjectURL(new Blob([image.bytes], { type: image.contentType }));
      this.objectUrls.set(link, objectUrl);
      const img = document.createElement("img");
      img.src = objectUrl;
      img.alt = `Design preview: ${link.textContent?.trim() || "Figma frame"}`;
      preview.replaceChildren(img);
    } catch (e) {
      if (this.active && link.isConnected) {
        preview.textContent = "Design preview unavailable";
        console.debug("[linear-spec-review] Figma screenshot unavailable:", e);
      }
    }
  }

  private async loadImage(url: string): Promise<StoredImage> {
    if (this.runningImages >= 4) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    if (!this.active) throw new Error("Figma preview stopped");
    this.runningImages++;
    try {
      return await this.host.loadFigmaScreenshot(url);
    } finally {
      this.runningImages--;
      this.waiting.shift()?.();
    }
  }

  private screenshotsForProject(projectId: string): Promise<Map<string, string>> {
    let pending = this.projects.get(projectId);
    if (!pending) {
      pending = this.host.getFigmaScreenshots(projectId);
      this.projects.set(projectId, pending);
      void pending.catch(() => this.projects.delete(projectId));
    }
    return pending;
  }

  private releaseDetachedImages(): void {
    for (const [link, url] of this.objectUrls) {
      if (link.isConnected) continue;
      URL.revokeObjectURL(url);
      this.objectUrls.delete(link);
    }
  }
}
