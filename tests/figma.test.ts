import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { commentFigmaScreenshots, figmaFrameKey, figmaScreenshots } from "../src/linear/figma.ts";
import { DEFAULT_SETTINGS } from "../src/types.ts";

const href = "https://www.figma.com/design/z6c6KIexetV3RR8cZE5SXt/Content-Library?node-id=19611-14579&t=ignored";
const screenshot = "https://uploads.linear.app/workspace/image/frame";
const key = "z6c6KIexetV3RR8cZE5SXt:19611-14579";

test("previews are enabled by default", () => {
  assert.equal(DEFAULT_SETTINGS.previewImages, true);
});

test("matches the same frame across Figma link variants", () => {
  assert.equal(figmaFrameKey(href), key);
  assert.equal(figmaFrameKey(href.replace("19611-14579", "19611%3A14579")), key);
  assert.equal(figmaFrameKey(href.replace("www.figma.com", "figma.com")), key);
  assert.equal(figmaFrameKey("https://not-figma.com/design/x?node-id=1-2"), null);
  assert.equal(figmaFrameKey("https://www.figma.com/design/x"), null);
  assert.equal(figmaFrameKey("not a URL"), null);
});

test("reads Figma screenshots from Linear's Yjs project state", () => {
  const doc = new Y.Doc();
  const frame = new Y.XmlElement("figma");
  frame.setAttribute("href", href);
  frame.setAttribute("screenshotUrl", screenshot);
  doc.getXmlFragment("prosemirror").insert(0, [frame]);
  const state = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  assert.deepEqual([...figmaScreenshots(state)], [[key, screenshot]]);
  doc.destroy();
});

test("reads only Linear-hosted screenshots from comment editor JSON", () => {
  const body = JSON.stringify({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      { type: "figma", attrs: { href, screenshotUrl: screenshot } },
      { type: "figma", attrs: { href: href.replace("19611-14579", "1-2"), screenshotUrl: "https://example.com/image" } },
    ],
  });
  assert.deepEqual([...commentFigmaScreenshots(body)], [[key, screenshot]]);
  assert.equal(commentFigmaScreenshots("not JSON").size, 0);
  assert.equal(commentFigmaScreenshots(null).size, 0);
});
