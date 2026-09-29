// ─────────────────────────────────────────────────────────────────────────
// DEMO MODE — configuration only. No business logic lives here.
//
// The scenario uses the same two facility rows a real user would pick from
// the requirement-creation form (seeded in prisma/seed.ts): CWH Ambala as
// the source, Apollo Pharmacy Distribution Hub (Hyderabad) as the exact
// destination — the same real-world endpoint the POC's original pharma
// cold-chain narrative already delivered to. The SLA deadline is computed
// relative to "now" at demo-start time (not a fixed calendar date) so the
// demo stays meaningful no matter when it's actually run.
// ─────────────────────────────────────────────────────────────────────────

export const DEMO_SCENARIO = {
  originFacilityName: "CWH Ambala",
  destinationFacilityName: "Apollo Pharmacy Distribution Hub",
  productType: "Pharmaceutical Products",
  productDescription: "Temperature-sensitive injectable formulations — Insulin and Biologics",
  weightKg: 2500,
  volumeCbm: 8.5,
  coldChainRequired: true,
  tempMinCelsius: 2,
  tempMaxCelsius: 8,
  // CWH Ambala → Hyderabad is a long-haul corridor (~1,800 road km) — sized
  // to comfortably cover the eligible transporters' estimated cost.
  maxCostInr: 220000,
  /** SLA deadline = demo start time + this many hours. Keeps the demo evergreen. */
  slaHoursFromStart: 40,
  specialInstructions: "Handle with care. Do not stack more than 3 boxes high. Temperature log required every 2 hours.",
};

/**
 * Real mock route events (seeded in prisma/seed.ts) that "Trigger Road
 * Event" / "Trigger Festival Impact" activate on demand by shifting their
 * validity window to bracket right now — same event content and severity,
 * just guaranteed live regardless of the real calendar date. Both sit
 * geographically on the Ambala→Hyderabad corridor (within the 0.5°
 * relevance buffer used by the route-event relevance check), unlike the
 * original Pune-area events which no longer overlap this corridor.
 */
export const DEMO_ROAD_EVENT_TITLE = "Multi-Vehicle Accident — NH-65 near Humnabad";
export const DEMO_FESTIVAL_EVENT_TITLE = "IPL Match — Rajiv Gandhi International Stadium";
