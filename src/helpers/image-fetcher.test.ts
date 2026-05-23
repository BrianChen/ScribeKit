import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { fetchImage, fetchImages } = await import("./image-fetcher.ts");

describe("fetchImage", () => {
  it("rejects non-HTTPS URLs", async () => {
    await assert.rejects(
      fetchImage("http://example.com/image.jpg"),
      /URL validation failed/
    );
  });

  it("rejects private IPs", async () => {
    await assert.rejects(
      fetchImage("https://192.168.1.1/image.jpg"),
      /URL validation failed/
    );
  });
});

describe("fetchImages", () => {
  it("collects errors without throwing", async () => {
    const result = await fetchImages([
      "http://example.com/a.jpg",
      "http://example.com/b.jpg",
    ]);
    assert.equal(result.images.length, 0);
    assert.equal(result.errors.length, 2);
  });
});
