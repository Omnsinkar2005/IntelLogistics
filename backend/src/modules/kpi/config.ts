// Configurable weights and thresholds for transporter performance scoring.
// Single source of truth for the KPI engine (engine.ts). Move to DB-backed
// per-tenant config later if the POC needs it.

// Must sum to 1.0 — enforced by a test, not at runtime, to keep this a
// plain, easily-edited config object.
export const KPI_WEIGHTS = {
  otif: 0.25,
  slaCompliance: 0.2,
  tat: 0.15,
  trackingCompliance: 0.15,
  damageShortage: 0.1,
  podCompliance: 0.1,
  exceptionRate: 0.05,
};

export const KPI_THRESHOLDS = {
  // TAT normalization band (hours) — mirrors the matching engine's bands
  // so "good TAT" means the same thing in both places.
  bestTatHours: 18,
  worstTatHours: 36,
  // A shipment is "tracked" only if no gap between consecutive GPS pings
  // (including dispatch→first-ping and last-ping→delivery) exceeds this.
  trackingGapMinutesThreshold: 30,
  // Below this many pings during transit, tracking can't be judged compliant
  // regardless of gaps (too sparse to mean anything).
  minLocationPingsForCompliance: 2,
};
