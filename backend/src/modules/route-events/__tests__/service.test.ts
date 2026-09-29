import { describe, it, expect } from "vitest";
import { bboxesOverlap } from "../service";
import { RouteEventBoundingBox } from "../types";

// The Pune → Hyderabad corridor bbox used elsewhere in the test suite's fixtures.
const CORRIDOR: RouteEventBoundingBox = { latMin: 16.885, latMax: 19.0204, lngMin: 73.3567, lngMax: 78.9867 };

describe("bboxesOverlap — geographic relevance", () => {
  it("is relevant when an event's affected region overlaps the shipment corridor", () => {
    const solapurEvent: RouteEventBoundingBox = { latMin: 17.55, latMax: 17.75, lngMin: 75.85, lngMax: 76.05 };
    expect(bboxesOverlap(CORRIDOR, solapurEvent)).toBe(true);
  });

  it("is not relevant when an event is far outside the shipment corridor", () => {
    const delhiEvent: RouteEventBoundingBox = { latMin: 28.4, latMax: 28.9, lngMin: 76.8, lngMax: 77.3 };
    expect(bboxesOverlap(CORRIDOR, delhiEvent)).toBe(false);
  });

  it("treats boxes that only touch at an edge as overlapping", () => {
    const a: RouteEventBoundingBox = { latMin: 0, latMax: 10, lngMin: 0, lngMax: 10 };
    const b: RouteEventBoundingBox = { latMin: 10, latMax: 20, lngMin: 10, lngMax: 20 };
    expect(bboxesOverlap(a, b)).toBe(true);
  });

  it("is symmetric", () => {
    const a: RouteEventBoundingBox = { latMin: 17.55, latMax: 17.75, lngMin: 75.85, lngMax: 76.05 };
    const b: RouteEventBoundingBox = { latMin: 28.4, latMax: 28.9, lngMin: 76.8, lngMax: 77.3 };
    expect(bboxesOverlap(a, b)).toBe(bboxesOverlap(b, a));
  });
});
