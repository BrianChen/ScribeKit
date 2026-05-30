import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ScribeKitError } from "./errors.ts";

describe("ScribeKitError", () => {
  it("is an instance of Error", () => {
    const e = new ScribeKitError("test");
    assert.ok(e instanceof Error);
  });

  it("is an instance of ScribeKitError", () => {
    const e = new ScribeKitError("test");
    assert.ok(e instanceof ScribeKitError);
  });

  it("sets name to ScribeKitError", () => {
    const e = new ScribeKitError("test");
    assert.equal(e.name, "ScribeKitError");
  });

  it("sets message", () => {
    const e = new ScribeKitError("something went wrong");
    assert.equal(e.message, "something went wrong");
  });

  it("preserves cause", () => {
    const original = new Error("original");
    const e = new ScribeKitError("wrapped", { cause: original });
    assert.equal(e.cause, original);
  });

  it("works without cause", () => {
    const e = new ScribeKitError("no cause");
    assert.equal(e.cause, undefined);
  });
});
