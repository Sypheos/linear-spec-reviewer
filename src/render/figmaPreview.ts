import { StoredImage } from "../linear/assets";
import { figmaFrameKey } from "../linear/figma";
import { ImageDownloads } from "./imageDownloads";

export interface FigmaPreviewHost {
  getFigmaScreenshots(projectId: string): Promise<Map<string, string>>;
  loadFigmaScreenshot(url: string): Promise<StoredImage>;
}

/** Renders Linear-hosted screenshots beside links, without contacting Figma. */
export class FigmaPreview {
  private readonly projects = new Map<string, Promise<Map<string, string>>>();
  private readonly disposers = new Set<() => void>();
  private readonly observer: IntersectionObserver;
  private readonly pending = new Map<Element, () => void>();
  private active = true;

  constructor(private readonly host: FigmaPreviewHost, private readonly downloads: ImageDownloads) {
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

  /** The caller owns the returned cleanup; Markdown sections and comments have different lifetimes. */
  render(root: HTMLElement, screenshots: ReadonlyMap<string, string> | Promise<ReadonlyMap<string, string>>): () => void {
    const previews: Array<{ link: HTMLAnchorElement; el: HTMLElement; url?: string }> = [];
    const links = root.querySelectorAll<HTMLAnchorElement>("a[href]");
    links.forEach((link) => {
      const key = figmaFrameKey(link.href);
      if (!key || link.dataset.lsrFigmaPreview) return;
      if (screenshots instanceof Map && !screenshots.has(key)) return;
      const el = document.createElement("span");
      el.className = "lsr-figma-preview";
      el.textContent = "Loading design…";
      link.dataset.lsrFigmaPreview = "true";
      link.insertAdjacentElement("afterend", el);
      const preview = { link, el, url: undefined as string | undefined };
      previews.push(preview);
      this.pending.set(el, () => { void this.show(preview, key, Promise.resolve(screenshots)); });
      this.observer.observe(el);
    });

    if (previews.length === 0) return () => {};
    let disposed = false;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      for (const preview of previews) {
        this.observer.unobserve(preview.el);
        this.pending.delete(preview.el);
        if (preview.url) URL.revokeObjectURL(preview.url);
        preview.el.remove();
        delete preview.link.dataset.lsrFigmaPreview;
      }
      this.disposers.delete(dispose);
    };
    this.disposers.add(dispose);
    return dispose;
  }

  projectScreenshots(projectId: string): Promise<ReadonlyMap<string, string>> {
    let pending = this.projects.get(projectId);
    if (!pending) {
      pending = this.host.getFigmaScreenshots(projectId);
      this.projects.set(projectId, pending);
      void pending.catch(() => {
        if (this.projects.get(projectId) === pending) this.projects.delete(projectId);
      });
    }
    return pending;
  }

  invalidateProject(projectId: string): void {
    this.projects.delete(projectId);
  }

  stop(): void {
    this.active = false;
    this.observer.disconnect();
    for (const dispose of [...this.disposers]) dispose();
    this.projects.clear();
  }

  private async show(
    preview: { link: HTMLAnchorElement; el: HTMLElement; url?: string },
    key: string,
    screenshots: Promise<ReadonlyMap<string, string>>
  ): Promise<void> {
    try {
      const url = (await screenshots).get(key);
      if (!this.active || !preview.el.isConnected) return;
      if (!url) {
        preview.el.remove();
        return;
      }
      const image = await this.downloads.run(() => {
        if (!this.active) throw new Error("Figma preview stopped");
        return this.host.loadFigmaScreenshot(url);
      });
      if (!this.active || !preview.el.isConnected) return;
      const objectUrl = URL.createObjectURL(new Blob([image.bytes], { type: image.contentType }));
      preview.url = objectUrl;
      const img = document.createElement("img");
      img.src = objectUrl;
      img.alt = `Design preview: ${preview.link.textContent?.trim() || "Figma frame"}`;
      preview.el.replaceChildren(img);
    } catch (e) {
      if (!this.active || !preview.el.isConnected) return;
      preview.el.textContent = "Design preview unavailable";
      console.debug("[linear-spec-review] Figma screenshot unavailable:", e);
    }
  }

}
