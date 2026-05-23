import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("google_places tool", () => {
  it("throws when API key is not set", async () => {
    const original = process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;

    const { searchPlaces } = await import("./google-places.ts");

    await assert.rejects(
      searchPlaces("Ichiran Ramen Tokyo"),
      /GOOGLE_PLACES_API_KEY is not set/
    );

    if (original) process.env.GOOGLE_PLACES_API_KEY = original;
  });
});
