import { Notice } from "obsidian";
import { AssetStore } from "../linear/assets";
import { ImageDownloads } from "./imageDownloads";

interface CachedUrl {
  promise: Promise<string>;
  readers: number;
}

/** Renders authenticated Linear uploads only within a known spec or comment body. */
export class AssetPreview {
  private readonly objectUrls = new Map<string, CachedUrl>();
  private readonly disposers = new Set<() => void>();
  private readonly pending = new Map<Element, () => void>();
  private readonly observer: IntersectionObserver;
  private active = true;

  constructor(
    private readonly store: AssetStore,
    private readonly inVault: boolean,
    private readonly previewImages: boolean,
    private readonly downloads: ImageDownloads
  ) {
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        this.observer.unobserve(entry.target);
        const load = this.pending.get(entry.target);
        this.pending.delete(entry.target);
        load?.();
      }
    }, { rootMargin: "300px" });
  }

  /** The owner disposes this section when Obsidian replaces it. */
  render(root: HTMLElement): () => void {
    const cleanups: Array<() => void> = [];
    root.querySelectorAll<HTMLImageElement>("img[src]").forEach((image) => {
      if (image.closest(".lsr-figma-preview")) return;
      const src = image.getAttribute("src");
      if (!src) return;
      if (!this.previewImages) {
        const link = document.createElement("a");
        link.href = image.dataset.lsrAssetSource ?? src;
        link.textContent = image.alt || "Open image";
        link.className = "lsr-image-source-link";
        image.replaceWith(link);
        cleanups.push(() => { if (link.isConnected) link.replaceWith(image); });
        return;
      }
      if (!src.startsWith("https://uploads.linear.app/")) return;
      let released = false;
      let releaseResource: (() => void) | null = null;
      const load = async (): Promise<void> => {
        try {
          const resource = this.acquire(this.key(src), src);
          releaseResource = resource.release;
          const objectUrl = await resource.promise;
          if (this.active && !released && image.isConnected) image.src = objectUrl;
        } catch (e) {
          if (!this.active || released) return;
          const message = e instanceof Error ? e.message : String(e);
          console.error("[linear-spec-review] asset preview failed:", message);
          new Notice(`Linear image could not load: ${message}`);
        }
      };
      this.pending.set(image, () => { void load(); });
      this.observer.observe(image);
      cleanups.push(() => {
        released = true;
        this.observer.unobserve(image);
        this.pending.delete(image);
        releaseResource?.();
        if (image.isConnected && image.src.startsWith("blob:")) image.src = src;
      });
    });

    if (cleanups.length === 0) return () => {};
    let disposed = false;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups) cleanup();
      this.disposers.delete(dispose);
    };
    this.disposers.add(dispose);
    return dispose;
  }

  stop(): void {
    this.active = false;
    this.observer.disconnect();
    for (const dispose of [...this.disposers]) dispose();
  }

  private key(src: string): string {
    // Upload signatures expire; the path identifies the file within this storage mode.
    return `${this.inVault}:${new URL(src).pathname}`;
  }

  private acquire(key: string, src: string): { promise: Promise<string>; release: () => void } {
    let entry = this.objectUrls.get(key);
    if (!entry) {
      const promise = this.downloads.run(() => {
        if (!this.active) throw new Error("Image preview stopped");
        return this.store.load(src, this.inVault);
      }).then(({ bytes, contentType }) => URL.createObjectURL(new Blob([bytes], { type: contentType })));
      entry = { promise, readers: 0 };
      this.objectUrls.set(key, entry);
      const current = entry;
      void promise.catch(() => {
        if (this.objectUrls.get(key) === current) this.objectUrls.delete(key);
      });
    }
    entry.readers++;
    const current = entry;
    return { promise: entry.promise, release: () => this.release(key, current) };
  }

  private release(key: string, entry: CachedUrl): void {
    if (--entry.readers > 0) return;
    if (this.objectUrls.get(key) === entry) this.objectUrls.delete(key);
    void entry.promise.then((url) => URL.revokeObjectURL(url), () => {});
  }
}
