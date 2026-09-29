// ─── Enums ────────────────────────────────────────────────────────────────────

export type RequirementStatus = "DRAFT" | "READY_TO_SEND" | "OPEN" | "MATCHED" | "ASSIGNED" | "CANCELLED";
export type OfferStatus = "PENDING" | "SUBMITTED" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";
export type ShipmentStatus = "CREATED" | "DISPATCHED" | "IN_TRANSIT" | "DELAYED" | "AT_RISK" | "DELIVERED" | "COMPLETED" | "CANCELLED";
export type PODStatus = "PENDING" | "SUBMITTED" | "APPROVED" | "REJECTED";
export type PODCondition = "GOOD" | "DAMAGED" | "PARTIAL";
export type PODVerificationMethod = "OTP" | "SIGNATURE" | "OTP_AND_SIGNATURE" | "QR_CONFIRMATION";
export type FacilityType = "CWH" | "DESTINATION";
export type PODVerificationStatus = "PENDING" | "VERIFIED";
export type SLARiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type SLAStatus = "ON_TRACK" | "AT_RISK" | "HIGH_RISK" | "BREACH" | "DELIVERED";
export type RiskConfidence = "HIGH" | "MEDIUM" | "LOW";
export type LocationSource = "SIMULATED" | "TRACCAR" | "AIS140" | "TRANSPORTER_API";
export type SimulationStatus = "RUNNING" | "PAUSED";
export type SimulationMode = "NORMAL" | "REDUCED" | "STOPPED" | "TRAFFIC";

// ─── Company / User ───────────────────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
  city?: string;
  state?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "VIEWER";
  companyId?: string;
}

// ─── Transporter ──────────────────────────────────────────────────────────────

// Each rate/duration is nullable — the KPI engine marks a KPI unavailable
// (null) rather than inventing a value when there isn't enough shipment
// history to compute it for the period.
export interface TransporterKPI {
  id: string;
  period: string;
  totalShipments: number;
  onTimeDeliveries: number;
  otifPercent: string | null;
  avgTatHours: string | null;
  slaBreachRatePercent: string | null;
  damageShortageRatePercent: string | null;
  trackingCompliancePercent: string | null;
  podCompliancePercent: string | null;
  exceptionRatePercent: string | null;
  compositeScore: string | null;
  computedAt: string;
}

export interface Vehicle {
  id: string;
  vehicleNumber: string;
  vehicleType: string;
  capacityKg: number;
  coldChain: boolean;
  tempMinCelsius?: string;
  tempMaxCelsius?: string;
  driverName?: string;
  driverPhone?: string;
}

export interface Transporter {
  id: string;
  name: string;
  city?: string;
  state?: string;
  coldChainCapable: boolean;
  baseCostPerKmInr: string;
  vehicleTypes: string[];
  vehicles?: Vehicle[];
  kpis?: TransporterKPI[];
  _count?: { vehicles: number; shipments: number };
}

// ─── KPI score contribution breakdown ──────────────────────────────────────────

export interface KPIComponent {
  key: "otif" | "tat" | "slaCompliance" | "trackingCompliance" | "damageShortage" | "podCompliance" | "exceptionRate";
  label: string;
  weight: number;
  value: number | null;
  normalizedScore: number | null;
  weightedContribution: number;
  available: boolean;
  eligibleCount: number;
  explanation: string;
}

export interface KPIBreakdown {
  totalShipments: number;
  onTimeDeliveries: number;
  otifPercent: number | null;
  avgTatHours: number | null;
  slaBreachRatePercent: number | null;
  damageShortageRatePercent: number | null;
  trackingCompliancePercent: number | null;
  podCompliancePercent: number | null;
  exceptionRatePercent: number | null;
  compositeScore: number | null;
  components: KPIComponent[];
  calculatedAt: string;
}

// ─── Facility ─────────────────────────────────────────────────────────────────

export interface Facility {
  id: string;
  type: FacilityType;
  name: string;
  organizationName?: string | null;
  address?: string | null;
  city: string;
  state: string;
  lat: string;
  lng: string;
  isActive: boolean;
}

// ─── Requirement ──────────────────────────────────────────────────────────────

export interface TransportRequirement {
  id: string;
  referenceNumber: string;
  companyId: string;
  createdById: string;
  originFacilityId?: string | null;
  destinationFacilityId?: string | null;
  originFacility?: Facility | null;
  destinationFacility?: Facility | null;
  // Nullable: an incomplete Draft may not have a route/cargo/cost/SLA set
  // yet. Guaranteed present once the requirement is Ready to Send or later.
  originCity: string | null;
  originState: string | null;
  originLat: string | null;
  originLng: string | null;
  destinationCity: string | null;
  destinationState: string | null;
  destinationLat: string | null;
  destinationLng: string | null;
  productType: string | null;
  productDescription?: string;
  weightKg: string | null;
  volumeCbm?: string;
  coldChainRequired: boolean;
  tempMinCelsius?: string;
  tempMaxCelsius?: string;
  maxCostInr: string | null;
  slaDeadline: string | null;
  specialInstructions?: string;
  status: RequirementStatus;
  // How many transporters this requirement was actually sent a quotation
  // request to — set once at send time. Pair with `_count.offers` (real
  // submitted quotes) to render "Responses: {submitted}/{this}".
  matchedTransporterCount?: number | null;
  // Deadline for transporters to submit a quotation, set at send time.
  quotationDeadline?: string | null;
  createdAt: string;
  updatedAt: string;
  company?: { id: string; name: string };
  createdBy?: { id: string; name: string };
  shipment?: { id: string; trackingNumber: string; status: ShipmentStatus } | null;
  _count?: { offers: number };
  offers?: TransporterOffer[];
}

// ─── Transporter Offer / Quotation ─────────────────────────────────────────────

export interface TransporterOffer {
  id: string;
  requirementId: string;
  transporterId: string;
  transporter?: { id: string; name: string; city?: string | null };
  quotedCostInr: string | null;
  notes?: string | null;
  status: OfferStatus;
  // Only ever present on the response to sending/resending a requirement
  // for quotation — a deliberate POC stand-in for actually emailing this
  // link to the transporter. See requirements/service.ts sendForQuotation.
  quoteToken?: string | null;
  submittedAt?: string | null;
  createdAt: string;
}

// Public, transporter-facing projection returned by GET /public/quote/:token.
export interface PublicQuotationInfo {
  transporterName: string;
  referenceNumber: string;
  originCity: string | null;
  originState: string | null;
  destinationCity: string | null;
  destinationState: string | null;
  productType: string | null;
  weightKg: string | null;
  volumeCbm?: string | null;
  coldChainRequired: boolean;
  tempMinCelsius?: string | null;
  tempMaxCelsius?: string | null;
  maxCostInr: string | null;
  slaDeadline: string | null;
  specialInstructions?: string | null;
  quotationDeadline: string | null;
  offerStatus: OfferStatus;
  alreadySubmitted: boolean;
  quotationWindowOpen: boolean;
  submittedQuotedCostInr: string | null;
  submittedRemarks?: string | null;
  submittedAt: string | null;
}

// Public, transporter-facing projection returned by GET
// /public/shipment-assignment/:token — the simulated "Shipment Assigned"
// notification.
export interface PublicAssignmentInfo {
  trackingNumber: string;
  companyName: string;
  transporterName: string;
  originName: string;
  destinationName: string;
  productType: string | null;
  weightKg: string | null;
  volumeCbm?: string | null;
  coldChainRequired: boolean;
  tempMinCelsius?: string | null;
  tempMaxCelsius?: string | null;
  slaDeadline: string;
  specialInstructions?: string | null;
  vehicleNumber: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
}

// ─── Matching ─────────────────────────────────────────────────────────────────

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

export interface EligibilityFailure {
  code: string;
  reason: string;
}

export interface MatchResult {
  transporter: {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    coldChainCapable: boolean;
    baseCostPerKmInr: number;
  };
  eligibility:
    | { eligible: true; eligibleVehicles: Vehicle[]; estimatedCostInr: number }
    | { eligible: false; failures: EligibilityFailure[]; estimatedCostInr: number };
  scoring: ScoringResult | null;
  rank: number | null;
  recommended: boolean;
}

// ─── Shipment ─────────────────────────────────────────────────────────────────

export interface Shipment {
  id: string;
  trackingNumber: string;
  assignmentToken?: string | null;
  requirementId: string;
  transporterId: string;
  vehicleId: string;
  originFacilityId?: string | null;
  destinationFacilityId?: string | null;
  originFacility?: Facility | null;
  destinationFacility?: Facility | null;
  originCity: string;
  originState: string;
  originLat: string;
  originLng: string;
  destinationCity: string;
  destinationState: string;
  destinationLat: string;
  destinationLng: string;
  routePolyline?: [number, number][] | null;
  distanceKm?: string;
  agreedCostInr: string;
  slaDeadline: string;
  status: ShipmentStatus;
  dispatchedAt?: string;
  deliveredAt?: string;
  completedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  transporter?: { id: string; name: string };
  vehicle?: { id: string; vehicleNumber: string; driverName?: string; driverPhone?: string };
  requirement?: { id: string; referenceNumber: string; productType: string; weightKg: string; coldChainRequired: boolean };
  sla?: SLA | null;
  pod?: { id: string; status: PODStatus; qrToken?: string | null; receiverOrganization?: string; submittedAt?: string; reviewedAt?: string } | null;
  slaEvents?: SLARiskEvent[];
  etaSnapshots?: ETASnapshot[];
}

export interface SLA {
  id: string;
  shipmentId: string;
  deadline: string;
  agreedTatHours: number;
  isBreached: boolean;
  breachedAt?: string;
  deliveryVarianceMinutes?: number;
}

export type ETAStatus = "ON_ROUTE" | "SLOW_MOVING" | "STOPPED" | "ARRIVING";
export type ETAConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface ETASnapshot {
  id: string;
  shipmentId: string;
  estimatedArrival: string;
  distanceRemainingKm: string;
  avgSpeedKmh: string;
  routeEventDelayMins: number;
  calculatedAt: string;
  estimatedTravelDurationMinutes?: number;
  status?: ETAStatus;
  confidence?: ETAConfidence;
  confidenceReason?: string;
  engine?: string;
  minutesToEta?: number;
  minutesToSla?: number;
  onTrack?: boolean;
  slaDeadline?: string;
}

export interface ShipmentLocation {
  id: string;
  latitude: string;
  longitude: string;
  speedKmh?: string;
  heading?: number;
  source: LocationSource;
  recordedAt: string;
}

// ─── SLA Risk ─────────────────────────────────────────────────────────────────

export interface RiskReason {
  code: string;
  description: string;
  impactMinutes: number;
  severity: SLARiskLevel;
}

export interface SLARiskEvent {
  id: string;
  shipmentId: string;
  status: SLAStatus;
  riskLevel: SLARiskLevel;
  predictedDelayMinutes: number;
  bufferMinutes: number;
  confidence: RiskConfidence;
  confidenceReason?: string;
  reasons: RiskReason[];
  isActive: boolean;
  triggeredAt: string;
  resolvedAt?: string;
}

// ─── Route Events ─────────────────────────────────────────────────────────────

export type RouteEventType =
  | "TRAFFIC" | "ROAD_CLOSURE" | "ACCIDENT" | "FESTIVAL" | "PUBLIC_EVENT"
  | "LOCAL_FUNCTION" | "CONSTRUCTION" | "WEATHER" | "STRIKE" | "OTHER";

export interface RouteEvent {
  id: string;
  eventType: RouteEventType;
  title: string;
  description: string;
  affectedHighway?: string;
  affectedCity?: string;
  affectedRegion: { latMin: number; latMax: number; lngMin: number; lngMax: number };
  severity: SLARiskLevel;
  estimatedDelayMinutes: number;
  source: "MOCK" | "EXTERNAL_API";
  validFrom: string;
  validUntil: string;
}

// ─── POD ──────────────────────────────────────────────────────────────────────

export interface POD {
  id: string;
  shipmentId: string;
  receiverOrganization?: string;
  deliveredQuantityKg?: string;
  condition?: PODCondition;
  packagingDamaged?: boolean | null;
  productIssueObserved?: boolean | null;
  temperatureExcursion?: boolean | null;
  hasException: boolean;
  deliveryLat?: string;
  deliveryLng?: string;
  verificationMethod?: PODVerificationMethod;
  verificationStatus: PODVerificationStatus;
  notes?: string;
  status: PODStatus;
  submittedAt?: string;
  reviewedById?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  reviewedBy?: { id: string; name: string } | null;
}

// ─── Public delivery confirmation (receiver-facing, reached via QR) ───────────

export interface PublicDeliveryInfo {
  trackingNumber: string;
  originName: string;
  destinationName: string;
  productType: string | null;
  expectedQuantityKg: string | null;
  coldChainRequired: boolean;
  alreadyConfirmed: boolean;
  podStatus: PODStatus;
}

// ─── Delivery Inspection & Acceptance (receiver submission payload) ───────────

export interface ConfirmDeliveryInput {
  receivedQuantityKg: number;
  isPartialDelivery: boolean;
  packagingDamaged: boolean;
  productIssueObserved: boolean;
  temperatureExcursion?: boolean;
  remarks?: string;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface DashboardSummary {
  shipments: {
    total: number;
    active: number;
    atRisk: number;
    delayed: number;
    deliveredToday: number;
  };
  requirements: { open: number };
  pod: { pendingReview: number };
  activeRisks: Array<{
    id: string;
    riskLevel: SLARiskLevel;
    shipment: {
      id: string;
      trackingNumber: string;
      originCity: string;
      destinationCity: string;
      transporter: { name: string };
    };
  }>;
  topTransporters: Array<{
    transporter: { id: string; name: string; city: string };
    otifPercent: string;
    compositeScore: string;
  }>;
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

export interface TimelineEvent {
  time: string;
  type: "STATUS" | "ROUTE_EVENT" | "SLA_RISK" | "POD";
  title: string;
  detail?: string;
}

// ─── API wrapper ──────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

// ─── Simulator ────────────────────────────────────────────────────────────────

export interface SimulationState {
  shipmentId: string;
  vehicleId: string;
  totalDistanceKm: number;
  progressFraction: number;
  speedKmh: number;
  status: SimulationStatus;
  mode: SimulationMode;
}

// ─── Demo Mode ────────────────────────────────────────────────────────────────

export interface DemoState {
  active: boolean;
  requirement?: TransportRequirement & { shipment?: Shipment | null };
  shipment?: Shipment | null;
  location?: ShipmentLocation | null;
  eta?: ETASnapshot | null;
  risk?: SLARiskEvent | null;
  pod?: POD | null;
  simState?: SimulationState | null;
}
