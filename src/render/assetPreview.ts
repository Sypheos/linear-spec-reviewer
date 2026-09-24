import { App, MarkdownView, Notice } from "obsidian";
import { AssetStore } from "../linear/assets";
import { FM_PROJECT_ID, LINEAR_COMMENTS_VIEW } from "../types";

/** In-memory previews for authenticated Linear uploads; never writes to the vault. */
export class AssetPreview {
  private readonly objectUrls = new Map<string, Promise<string>>();
  private readonly observer: MutationObserver;
  private active = true;

  constructor(
    private readonly app: App,
    private readonly store: AssetStore,
    private readonly inVault: () => boolean
  ) {
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
      attributeFilter: ["src"],
    });
    this.scan(document.body);
  }

  stop(): void {
    this.active = false;
    this.observer.disconnect();
    // Restore the original URL before releasing object URLs on plugin reload.
    document.querySelectorAll<HTMLImageElement>("img[data-lsr-asset-source]").forEach((img) => {
      img.src = img.dataset.lsrAssetSource ?? img.src;
      delete img.dataset.lsrAssetSource;
    });
    for (const pending of this.objectUrls.values()) {
      void pending.then((url) => URL.revokeObjectURL(url), () => {});
    }
    this.objectUrls.clear();
  }

  private scan(node: Node): void {
    this.checkImage(node);
    if (node instanceof Element) {
      node.querySelectorAll("img").forEach((img) => this.checkImage(img));
    }
  }

  private checkImage(node: Node): void {
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
    }).catch((e: unknown) => {
      if (!this.active) return;
      const message = e instanceof Error ? e.message : String(e);
      console.error("[linear-spec-review] asset preview failed:", message);
      new Notice(`Linear image could not load: ${message}`);
    });
  }

  private isLinearSpecImage(img: HTMLImageElement): boolean {
    const inComments = this.app.workspace.getLeavesOfType(LINEAR_COMMENTS_VIEW).some(
      (leaf) => leaf.view.containerEl.contains(img)
    );
    if (inComments) return true;

    let isSpec = false;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof MarkdownView) || !leaf.view.containerEl.contains(img)) return;
      const file = leaf.view.file;
      if (!file) return;
      isSpec = typeof this.app.metadataCache.getFileCache(file)?.frontmatter?.[FM_PROJECT_ID] === "string";
    });
    return isSpec;
  }

  private getObjectUrl(src: string): Promise<string> {
    // The signature changes and expires; the path identifies the asset.
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
}
