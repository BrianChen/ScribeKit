import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validatePlaces } from "./cli.ts";

describe("validatePlaces", () => {
  it("returns no errors for valid places", () => {
    const places = [
      { placeName: "Times Square", destinationName: "New York City", country: "United States" },
    ];
    assert.deepEqual(validatePlaces(places), []);
  });

  it("errors when placeName is missing", () => {
    const places = [{ destinationName: "New York City", country: "United States" }];
    const errors = validatePlaces(places);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /placeName/);
  });

  it("errors when destinationName is missing", () => {
    const places = [{ placeName: "Times Square", country: "United States" }];
    const errors = validatePlaces(places);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /destinationName/);
  });

  it("errors when imageUrls exceeds 5", () => {
    const places = [{
      placeName: "Times Square",
      destinationName: "New York City",
      imageUrls: ["a", "b", "c", "d", "e", "f"],
    }];
    const errors = validatePlaces(places);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /5 image URLs/);
  });

  it("collects errors from multiple places", () => {
    const places = [
      { placeName: "Times Square" },          // missing destinationName
      { destinationName: "New York City" },   // missing placeName
    ];
    assert.equal(validatePlaces(places).length, 2);
  });

  it("allows exactly 5 imageUrls", () => {
    const places = [{
      placeName: "Times Square",
      destinationName: "New York City",
      imageUrls: ["a", "b", "c", "d", "e"],
    }];
    assert.deepEqual(validatePlaces(places), []);
  });
});
