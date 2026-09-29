import { api } from "./api";
import type {
  TransportRequirement, MatchResult, Shipment, ShipmentLocation,
  ETASnapshot, SLARiskEvent, RouteEvent, POD, DashboardSummary,
  Transporter, TimelineEvent, SLA, SimulationState, SimulationMode, User, KPIBreakdown, DemoState,
  Facility, FacilityType, PublicDeliveryInfo, PublicQuotationInfo, TransporterOffer, ConfirmDeliveryInput,
  PublicAssignmentInfo,
} from "@/types";

const unwrap = <T>(res: { data: { data: T } }) => res.data.data;

// ─── Dashboard ────────────────────────────────────────────────────────────────
export const getDashboardSummary = () =>
  api.get<{ data: DashboardSummary }>("/dashboard/summary").then(unwrap);

// ─── Requirements ─────────────────────────────────────────────────────────────
export const getRequirements = (companyId?: string) =>
  api.get<{ data: TransportRequirement[] }>("/requirements", { params: { companyId } }).then(unwrap);

export const getRequirement = (id: string) =>
  api.get<{ data: TransportRequirement }>(`/requirements/${id}`).then(unwrap);

export const createRequirement = (data: Record<string, unknown>) =>
  api.post<{ data: TransportRequirement }>("/requirements", data).then(unwrap);

export const updateRequirement = (id: string, data: Record<string, unknown>) =>
  api.patch<{ data: TransportRequirement }>(`/requirements/${id}`, data).then(unwrap);

export const updateRequirementStatus = (id: string, status: string) =>
  api.patch<{ data: TransportRequirement }>(`/requirements/${id}/status`, { status }).then(unwrap);

export const sendForQuotation = (id: string, data: { transporterIds: string[]; quotationDeadline: string }) =>
  api.post<{ data: TransportRequirement }>(`/requirements/${id}/send-for-quotation`, data).then(unwrap);

// ─── Quotation (public, transporter-facing, reached via one-time link) ────────
export const getPublicQuotationInfo = (token: string) =>
  api.get<{ data: PublicQuotationInfo }>(`/public/quote/${token}`).then(unwrap);

export const submitQuotation = (token: string, data: { quotedPriceInr: number; remarks?: string }) =>
  api
    .post<{ data: Pick<TransporterOffer, "status" | "quotedCostInr" | "notes" | "submittedAt"> }>(
      `/public/quote/${token}/submit`,
      data
    )
    .then(unwrap);

// ─── Facilities ───────────────────────────────────────────────────────────────
export const getFacilities = (type?: FacilityType) =>
  api.get<{ data: Facility[] }>("/facilities", { params: { type } }).then(unwrap);

// ─── Matching ─────────────────────────────────────────────────────────────────
export const getMatchingTransporters = (requirementId: string) =>
  api.get<{ data: MatchResult[] }>(`/requirements/${requirementId}/transporters`).then(unwrap);

// ─── Transporters ─────────────────────────────────────────────────────────────
export const getTransporters = () =>
  api.get<{ data: Transporter[] }>("/transporters").then(unwrap);

export const getTransporter = (id: string) =>
  api.get<{ data: Transporter }>(`/transporters/${id}`).then(unwrap);

export const getTransporterPerformance = (id: string) =>
  api.get<{ data: { transporter: Transporter; kpis: import("@/types").TransporterKPI[]; recentShipments: Shipment[] } }>(`/transporters/${id}/performance`).then(unwrap);

export const getKPIBreakdown = (transporterId: string, period?: string) =>
  api.get<{ data: { period: string; result: KPIBreakdown } }>(`/kpi/${transporterId}/breakdown`, { params: { period } }).then(unwrap);

// ─── Shipments ────────────────────────────────────────────────────────────────
export const getShipments = (status?: string) =>
  api.get<{ data: Shipment[] }>("/shipments", { params: { status } }).then(unwrap);

export const getShipment = (id: string) =>
  api.get<{ data: Shipment }>(`/shipments/${id}`).then(unwrap);

export const createShipment = (data: Record<string, unknown>) =>
  api.post<{ data: Shipment }>("/shipments", data).then(unwrap);

export const dispatchShipment = (id: string) =>
  api.patch<{ data: Shipment }>(`/shipments/${id}/dispatch`).then(unwrap);

export const completeShipment = (id: string) =>
  api.patch<{ data: Shipment }>(`/shipments/${id}/complete`).then(unwrap);

export const getShipmentTimeline = (id: string) =>
  api.get<{ data: { shipment: Shipment; events: TimelineEvent[] } }>(`/shipments/${id}/timeline`).then(unwrap);

// ─── Assignment Notification (public, transporter-facing, reached via one-time link) ──
export const getPublicAssignmentInfo = (token: string) =>
  api.get<{ data: PublicAssignmentInfo }>(`/public/shipment-assignment/${token}`).then(unwrap);

// ─── Tracking ─────────────────────────────────────────────────────────────────
export const getLatestLocation = (shipmentId: string) =>
  api.get<{ data: ShipmentLocation | null }>(`/shipments/${shipmentId}/location`).then(unwrap);

export const getLocationHistory = (shipmentId: string) =>
  api.get<{ data: ShipmentLocation[] }>(`/shipments/${shipmentId}/locations`).then(unwrap);

export const getETA = (shipmentId: string) =>
  api.get<{ data: ETASnapshot | null }>(`/shipments/${shipmentId}/eta`).then(unwrap);

export const getSimulationState = (shipmentId: string) =>
  api.get<{ data: SimulationState | null }>(`/shipments/${shipmentId}/simulation`).then(unwrap);

export const startSimulation = (shipmentId: string) =>
  api.post<{ data: SimulationState | null }>(`/shipments/${shipmentId}/simulation/start`).then(unwrap);

export const pauseSimulation = (shipmentId: string) =>
  api.post<{ data: SimulationState | null }>(`/shipments/${shipmentId}/simulation/pause`).then(unwrap);

export const setSimulationMode = (shipmentId: string, mode: SimulationMode) =>
  api.post<{ data: SimulationState | null }>(`/shipments/${shipmentId}/simulation/mode`, { mode }).then(unwrap);

// ─── SLA ──────────────────────────────────────────────────────────────────────
export const getShipmentSLA = (shipmentId: string) =>
  api.get<{ data: SLA | null }>(`/shipments/${shipmentId}/sla`).then(unwrap);

export const getShipmentSLARisk = (shipmentId: string) =>
  api.get<{ data: { activeRisk: SLARiskEvent | null; history: SLARiskEvent[] } }>(`/shipments/${shipmentId}/sla-risk`).then(unwrap);

// ─── Route Events ─────────────────────────────────────────────────────────────
export const getShipmentRouteEvents = (shipmentId: string) =>
  api.get<{ data: RouteEvent[] }>(`/shipments/${shipmentId}/events`).then(unwrap);

// ─── POD ──────────────────────────────────────────────────────────────────────
export const getPOD = (shipmentId: string) =>
  api.get<{ data: POD }>(`/shipments/${shipmentId}/pod`).then(unwrap);

export const reviewPOD = (shipmentId: string, action: "APPROVE" | "REJECT", reviewedById: string, rejectionReason?: string) =>
  api.patch<{ data: POD }>(`/shipments/${shipmentId}/pod/review`, { action, reviewedById, rejectionReason }).then(unwrap);

// ─── Public delivery confirmation (receiver-facing, reached via QR) ───────────
export const getPublicDeliveryInfo = (token: string) =>
  api.get<{ data: PublicDeliveryInfo }>(`/public/pod/${token}`).then(unwrap);

export const confirmDelivery = (token: string, data: ConfirmDeliveryInput) =>
  api.post<{ data: POD }>(`/public/pod/${token}/confirm`, data).then(unwrap);

// ─── Users ────────────────────────────────────────────────────────────────────
export const getUsers = () =>
  api.get<{ data: User[] }>("/users").then(unwrap);

export const getDefaultManager = () =>
  api.get<{ data: User | null }>("/users/default-manager").then(unwrap);

// ─── Demo Mode ────────────────────────────────────────────────────────────────
// Every call here is a thin wrapper around the same real business-logic
// endpoints defined above — see backend/src/modules/demo for what each one
// actually does under the hood.
export const startDemo = () =>
  api.post<{ data: { requirement: TransportRequirement; alreadyStarted: boolean } }>("/demo/start").then(unwrap);

export const resetDemo = () =>
  api.post<{ data: { reset: true } }>("/demo/reset").then(unwrap);

export const getDemoState = () =>
  api.get<{ data: DemoState }>("/demo/state").then(unwrap);

export const attachDemoShipment = (shipmentId: string) =>
  api.post<{ data: Shipment }>("/demo/attach-shipment", { shipmentId }).then(unwrap);

export const startDemoMovement = () =>
  api.post<{ data: Shipment }>("/demo/movement/start").then(unwrap);

export const pauseDemoMovement = () =>
  api.post<{ data: { paused: true } }>("/demo/movement/pause").then(unwrap);

export const triggerDemoTrafficDelay = () =>
  api.post<{ data: { mode: string } }>("/demo/trigger/traffic-delay").then(unwrap);

export const triggerDemoRoadEvent = () =>
  api.post<{ data: { event: string; eventType: string } }>("/demo/trigger/road-event").then(unwrap);

export const triggerDemoFestivalEvent = () =>
  api.post<{ data: { event: string; eventType: string } }>("/demo/trigger/festival-event").then(unwrap);

export const recalculateDemoETA = () =>
  api.post<{ data: ETASnapshot | null }>("/demo/eta/recalculate").then(unwrap);

export const triggerDemoSLARisk = () =>
  api.post<{ data: SLARiskEvent | null }>("/demo/trigger/sla-risk").then(unwrap);

export const moveDemoToDestination = () =>
  api.post<{ data: Shipment }>("/demo/movement/complete").then(unwrap);

export const quickConfirmDemoDelivery = () =>
  api.post<{ data: POD }>("/demo/pod/quick-confirm").then(unwrap);

export const approveDemoPod = () =>
  api.post<{ data: Shipment }>("/demo/pod/approve").then(unwrap);

export const refreshDemoKpis = () =>
  api.post<{ data: import("@/types").TransporterKPI | null }>("/demo/kpis/refresh").then(unwrap);
