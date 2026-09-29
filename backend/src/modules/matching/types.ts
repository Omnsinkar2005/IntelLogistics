// ─── Requirement snapshot passed into the engine ─────────────────────────────

export interface RequirementInput {
  originCity: string;
  destinationCity: string;
  weightKg: number;
  coldChainRequired: boolean;
  tempMinCelsius: number | null;
  tempMaxCelsius: number | null;
  maxCostInr: number;
  slaDeadline: Date;
  estimatedDistanceKm: number;
}

// ─── Transporter data passed into the engine ─────────────────────────────────

export interface SupportedRoute {
  origin: string;
  destination: string;
}

export interface VehicleCandidate {
  id: string;
  vehicleNumber: string;
  vehicleType: string;
  capacityKg: number;
  coldChain: boolean;
  tempMinCelsius: number | null;
  tempMaxCelsius: number | null;
  driverName: string | null;
  driverPhone: string | null;
}

// Each rate/duration is nullable — the KPI engine (src/modules/kpi) marks a
// KPI unavailable (null) rather than inventing a value when a transporter
// doesn't have enough historical shipment data for it in the period.
export interface KPISnapshot {
  period: string;
  totalShipments: number;
  otifPercent: number | null;
  avgTatHours: number | null;
  slaBreachRatePercent: number | null;
  damageShortageRatePercent: number | null;
  trackingCompliancePercent: number | null;
  podCompliancePercent: number | null;
  exceptionRatePercent: number | null;
}

export interface TransporterCandidate {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  coldChainCapable: boolean;
  supportedRoutes: SupportedRoute[];
  baseCostPerKmInr: number;
  vehicles: VehicleCandidate[];
  latestKPI: KPISnapshot | null;
}

// ─── Eligibility ──────────────────────────────────────────────────────────────

export type IneligibilityCode =
  | "COLD_CHAIN_NOT_AVAILABLE"
  | "ROUTE_NOT_COVERED"
  | "INSUFFICIENT_VEHICLE_CAPACITY"
  | "COST_EXCEEDS_MAXIMUM"
  | "NO_ACTIVE_VEHICLES"
  | "TEMPERATURE_RANGE_MISMATCH";

export interface EligibilityFailure {
  code: IneligibilityCode;
  reason: string;
}

export interface EligibilityResult {
  eligible: true;
  eligibleVehicles: VehicleCandidate[];
  estimatedCostInr: number;
}

export interface IneligibilityResult {
  eligible: false;
  failures: EligibilityFailure[];
  estimatedCostInr: number;
}

export type EligibilityOutcome = EligibilityResult | IneligibilityResult;

// ─── Scoring ──────────────────────────────────────────────────────────────────

// Defined locally so the engine has zero external dependencies
export type RiskSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ScoringWeights {
  otif: number;
  slaCompliance: number;
  tat: number;
  trackingCompliance: number;
  damageShortage: number;
  podCompliance: number;
  cost: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  otif: 0.30,
  slaCompliance: 0.20,
  tat: 0.15,
  trackingCompliance: 0.10,
  damageShortage: 0.10,
  podCompliance: 0.05,
  cost: 0.10,
};

export interface ScoreComponent {
  label: string;
  weight: number;
  rawValue: number;
  normalizedScore: number;
  weightedScore: number;
  explanation: string;
  /** False when the underlying KPI was unavailable and a neutral score was substituted. */
  available: boolean;
}

export interface ScoringResult {
  totalScore: number;
  components: ScoreComponent[];
  narrative: string;
  hasKPIHistory: boolean;
}

// ─── Final matching result per transporter ───────────────────────────────────

export interface MatchResult {
  transporter: {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    coldChainCapable: boolean;
    baseCostPerKmInr: number;
  };
  eligibility: EligibilityOutcome;
  scoring: ScoringResult | null;
  rank: number | null;
  recommended: boolean;
}
