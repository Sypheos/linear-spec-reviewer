import assert from "node:assert/strict";
import { test } from "node:test";
import { ImageDownloads } from "../src/render/imageDownloads.ts";

test("concurrent images share a fixed number of download slots", async () => {
  const downloads = new ImageDownloads(4);
  let active = 0;
  let peak = 0;
  const jobs = Array.from({ length: 20 }, (_, index) => downloads.run(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    active--;
    return index;
  }));
  assert.deepEqual(await Promise.all(jobs), Array.from({ length: 20 }, (_, index) => index));
  assert.equal(peak, 4);
  assert.equal(active, 0);
});

test("a failed download releases its slot", async () => {
  const downloads = new ImageDownloads(1);
  const failed = downloads.run(async () => { throw new Error("offline"); });
  const next = downloads.run(async () => "ready");
  await assert.rejects(failed, /offline/);
  assert.equal(await next, "ready");
});
