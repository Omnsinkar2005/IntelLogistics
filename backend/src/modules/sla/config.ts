// Configurable thresholds for the deterministic SLA risk engine.
// Single source of truth — used by both the base status decision (engine.ts)
// and the aggravating-factor rules (rules/index.ts). Move to DB-backed
// per-tenant config later if the POC needs it.
export const SLA_RISK_THRESHOLDS = {
  // ── Base ETA-vs-deadline status ──────────────────────────────────────────
  /** ETA within this many minutes of the deadline → AT_RISK. */
  warningBufferMinutes: 120,
  /** Predicted to miss AND this little time left before the deadline → BREACH instead of HIGH_RISK. */
  imminentBreachBufferMinutes: 30,

  // ── Aggravating-factor rules ──────────────────────────────────────────────
  /** Current speed this many % below the historical average → flagged. */
  speedDropPercent: 30,
  /** Ignore speed-drop % on very low-speed baselines (the ratio gets noisy). */
  minMeaningfulSpeedKmh: 5,
  /** Below this speed, the vehicle is considered stationary. */
  stoppedSpeedKmh: 2,
  /** Continuous stop duration before it's flagged as an unexpected halt. */
  vehicleStoppedMinutes: 15,
  /** Schedule variance (actual vs. planned pace) before it's flagged. */
  accumulatedDelayMinutes: 15,
  /** Active route-event delay at/above this → worth mentioning at all (severity/"high-impact" comes from the event's own curated severity). */
  mediumImpactRouteEventMinutes: 15,
  /** Time-to-deadline below this → "remaining buffer is insufficient". */
  lowBufferMinutes: 45,
  /** No GPS update for this long → confidence penalty. */
  staleGpsMinutes: 20,

  // ── Escalation ────────────────────────────────────────────────────────────
  // Total weighted severity (LOW=0, MEDIUM=1, HIGH=2, CRITICAL=3) of fired
  // aggravating reasons needed to bump the base status up by N levels.
  escalation: {
    oneLevelWeight: 2,
    twoLevelWeight: 5,
  },
};
