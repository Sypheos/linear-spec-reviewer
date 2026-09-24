import * as Y from "yjs";

/** Match a Figma frame across Linear's editor state and its Markdown export. */
export function figmaFrameKey(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !["figma.com", "www.figma.com"].includes(url.host)) {
    return null;
  }
  const file = /^\/design\/([a-zA-Z0-9]+)(?:\/|$)/.exec(url.pathname)?.[1];
  const node = url.searchParams.get("node-id")?.replace(/:/g, "-");
  return file && node ? `${file}:${node}` : null;
}

/** Linear stores Figma screenshots in its base64-encoded Yjs editor state. */
export function figmaScreenshots(contentState: string): Map<string, string> {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, Buffer.from(contentState, "base64"));
    const screenshots = new Map<string, string>();
    const visit = (node: Y.XmlFragment | Y.XmlElement | Y.XmlText | Y.XmlHook): void => {
      if (node instanceof Y.XmlElement && node.nodeName === "figma") {
        addScreenshot(screenshots, node.getAttributes());
      }
      if (node instanceof Y.XmlFragment || node instanceof Y.XmlElement) {
        for (const child of node.toArray()) visit(child);
      }
    };
    visit(doc.getXmlFragment("prosemirror"));
    return screenshots;
  } finally {
    doc.destroy();
  }
}

/** Comments expose their editor nodes as ProseMirror JSON, not Yjs. */
export function commentFigmaScreenshots(bodyData: string | null): Map<string, string> {
  const screenshots = new Map<string, string>();
  if (!bodyData) return screenshots;
  let root: unknown;
  try {
    root = JSON.parse(bodyData);
  } catch {
    return screenshots;
  }
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const node = value as { type?: unknown; attrs?: unknown; content?: unknown };
    if (node.type === "figma") addScreenshot(screenshots, node.attrs);
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(root);
  return screenshots;
}

function addScreenshot(screenshots: Map<string, string>, value: unknown): void {
  if (!value || typeof value !== "object") return;
  const attrs = value as { href?: unknown; screenshotUrl?: unknown };
  const key = typeof attrs.href === "string" ? figmaFrameKey(attrs.href) : null;
  if (key && typeof attrs.screenshotUrl === "string" &&
    attrs.screenshotUrl.startsWith("https://uploads.linear.app/")) {
    screenshots.set(key, attrs.screenshotUrl);
  }
}
