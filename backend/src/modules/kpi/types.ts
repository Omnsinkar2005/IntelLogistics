// ─────────────────────────────────────────────────────────────────────────
// TRANSPORTER PERFORMANCE / KPI ENGINE
//
// Computes the 7 KPIs from a transporter's historical shipments — never
// from manually-entered numbers. Each KPI has its own eligible cohort
// (see engine.ts for exact definitions); when that cohort is empty the
// KPI is `null` ("unavailable"), not zero or invented.
// ─────────────────────────────────────────────────────────────────────────

export type PODStatusLike = "PENDING" | "SUBMITTED" | "APPROVED" | "REJECTED";
export type PODConditionLike = "GOOD" | "DAMAGED" | "PARTIAL";

/**
 * Plain, DB-agnostic view of one historical shipment — everything the KPI
 * engine needs, and nothing about how it was fetched. The service layer
 * maps Prisma rows into this shape.
 */
export interface HistoricalShipmentRecord {
  id: string;
  status: "DELIVERED" | "COMPLETED";
  dispatchedAt: Date | null;
  deliveredAt: Date | null;
  slaDeadline: Date;
  /** Only populated once a shipment reaches COMPLETED (see shipments/service.ts). */
  slaIsBreached: boolean | null;
  podStatus: PODStatusLike | null;
  podCondition: PODConditionLike | null;
  /** GPS fix timestamps during transit, any order. */
  locationTimestamps: Date[];
  /** Whether any HIGH/CRITICAL SLA risk event was ever raised for this shipment. */
  hadHighSeverityException: boolean;
}

export interface KPIComponent {
  key: "otif" | "tat" | "slaCompliance" | "trackingCompliance" | "damageShortage" | "podCompliance" | "exceptionRate";
  label: string;
  /** Configured weight (0–1) before renormalization for unavailable components. */
  weight: number;
  /** Raw KPI value — a percent (0–100) for rate KPIs, hours for TAT. Null = unavailable. */
  value: number | null;
  /** 0–100 "goodness" after direction-normalizing (e.g. breach rate is inverted). Null = unavailable. */
  normalizedScore: number | null;
  /** Actual points this component contributes to the 0–100 composite score. */
  weightedContribution: number;
  available: boolean;
  /** Size of the cohort this KPI was computed over. */
  eligibleCount: number;
  explanation: string;
}

export interface KPIComputationResult {
  /** Size of the settled cohort (DELIVERED + COMPLETED) for the period — context, not a KPI itself. */
  totalShipments: number;
  onTimeDeliveries: number;
  otifPercent: number | null;
  avgTatHours: number | null;
  slaBreachRatePercent: number | null;
  damageShortageRatePercent: number | null;
  trackingCompliancePercent: number | null;
  podCompliancePercent: number | null;
  exceptionRatePercent: number | null;
  /** Null only when every component below is unavailable. */
  compositeScore: number | null;
  components: KPIComponent[];
  calculatedAt: Date;
}
