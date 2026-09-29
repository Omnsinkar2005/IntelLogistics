import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import type { ShipmentStatus, RequirementStatus, OfferStatus, PODStatus, PODCondition, PODVerificationMethod, SLARiskLevel, RiskReason } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatINR(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(num);
}

export function formatDate(iso: string): string {
  return format(parseISO(iso), "dd MMM yyyy, HH:mm");
}

export function formatDateShort(iso: string): string {
  return format(parseISO(iso), "dd MMM yyyy");
}

export function formatTime(iso: string): string {
  return format(parseISO(iso), "HH:mm");
}

export function timeAgo(iso: string): string {
  return formatDistanceToNow(parseISO(iso), { addSuffix: true });
}

export function minutesToHuman(minutes: number): string {
  if (minutes < 0) return `${Math.abs(Math.round(minutes))} min overdue`;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function slaMinutesLabel(minutes: number | undefined): string {
  if (minutes === undefined) return "—";
  if (minutes < 0) return `${minutesToHuman(Math.abs(minutes))} overdue`;
  return `${minutesToHuman(minutes)} remaining`;
}

export function shipmentStatusLabel(status: ShipmentStatus): string {
  const map: Record<ShipmentStatus, string> = {
    CREATED: "Created", DISPATCHED: "Dispatched", IN_TRANSIT: "In Transit",
    DELAYED: "Delayed", AT_RISK: "At Risk", DELIVERED: "Delivered",
    COMPLETED: "Completed", CANCELLED: "Cancelled",
  };
  return map[status] ?? status;
}

export function requirementStatusLabel(status: RequirementStatus): string {
  const map: Record<RequirementStatus, string> = {
    DRAFT: "Draft",
    READY_TO_SEND: "Ready to Send",
    OPEN: "Sent for Quotation",
    MATCHED: "Quotations Received",
    ASSIGNED: "Transporter Assigned",
    CANCELLED: "Cancelled",
  };
  return map[status] ?? status;
}

/**
 * "Responses: {quotes submitted}/{transporters sent to}" for the
 * Requirements list. Undefined/null until the requirement has actually
 * been sent (matchedTransporterCount is only snapshotted on send).
 */
export function requirementResponsesLabel(req: {
  status: RequirementStatus;
  matchedTransporterCount?: number | null;
  _count?: { offers: number };
}): string {
  if (req.status === "DRAFT" || req.status === "READY_TO_SEND") return "—";
  if (req.matchedTransporterCount === null || req.matchedTransporterCount === undefined) return "—";
  return `Responses: ${req._count?.offers ?? 0}/${req.matchedTransporterCount}`;
}

export function offerStatusLabel(status: OfferStatus): string {
  const map: Record<OfferStatus, string> = {
    PENDING: "Pending", SUBMITTED: "Quoted", ACCEPTED: "Accepted", REJECTED: "Rejected", WITHDRAWN: "Declined",
  };
  return map[status] ?? status;
}

export function offerStatusColor(status: OfferStatus): string {
  const map: Record<OfferStatus, string> = {
    PENDING: "bg-slate-100 text-slate-600",
    SUBMITTED: "bg-blue-100 text-blue-700",
    ACCEPTED: "bg-emerald-100 text-emerald-700",
    REJECTED: "bg-red-100 text-red-700",
    WITHDRAWN: "bg-slate-100 text-slate-500",
  };
  return map[status] ?? "bg-slate-100 text-slate-700";
}

export function podStatusLabel(status: PODStatus): string {
  const map: Record<PODStatus, string> = {
    PENDING: "Pending", SUBMITTED: "Submitted", APPROVED: "Approved", REJECTED: "Rejected",
  };
  return map[status] ?? status;
}

export function podConditionLabel(condition: PODCondition): string {
  const map: Record<PODCondition, string> = { GOOD: "Good", DAMAGED: "Damaged", PARTIAL: "Partial" };
  return map[condition] ?? condition;
}

export function podConditionColor(condition: PODCondition): string {
  const map: Record<PODCondition, string> = {
    GOOD: "bg-emerald-100 text-emerald-700",
    DAMAGED: "bg-red-100 text-red-700",
    PARTIAL: "bg-amber-100 text-amber-700",
  };
  return map[condition] ?? "bg-slate-100 text-slate-700";
}

export function podVerificationMethodLabel(method: PODVerificationMethod): string {
  const map: Record<PODVerificationMethod, string> = {
    OTP: "OTP",
    SIGNATURE: "Digital Signature",
    OTP_AND_SIGNATURE: "OTP + Digital Signature",
    QR_CONFIRMATION: "QR Code Confirmation",
  };
  return map[method] ?? method;
}

export function riskLevelLabel(level: SLARiskLevel): string {
  const map: Record<SLARiskLevel, string> = {
    LOW: "Low Risk", MEDIUM: "Medium Risk", HIGH: "High Risk", CRITICAL: "Critical",
  };
  return map[level] ?? level;
}

export function shipmentStatusColor(status: ShipmentStatus): string {
  const map: Record<ShipmentStatus, string> = {
    CREATED: "bg-slate-100 text-slate-600",
    DISPATCHED: "bg-blue-100 text-blue-700",
    IN_TRANSIT: "bg-cyan-100 text-cyan-700",
    DELAYED: "bg-amber-100 text-amber-700",
    AT_RISK: "bg-red-100 text-red-700",
    DELIVERED: "bg-emerald-100 text-emerald-700",
    COMPLETED: "bg-emerald-100 text-emerald-700",
    CANCELLED: "bg-slate-100 text-slate-500",
  };
  return map[status] ?? "bg-slate-100 text-slate-700";
}

export function requirementStatusColor(status: RequirementStatus): string {
  const map: Record<RequirementStatus, string> = {
    DRAFT: "bg-slate-100 text-slate-600",
    READY_TO_SEND: "bg-amber-100 text-amber-700",
    OPEN: "bg-blue-100 text-blue-700",
    MATCHED: "bg-purple-100 text-purple-700",
    ASSIGNED: "bg-emerald-100 text-emerald-700",
    CANCELLED: "bg-slate-100 text-slate-500",
  };
  return map[status] ?? "bg-slate-100 text-slate-700";
}

export function riskLevelColor(level: SLARiskLevel): string {
  const map: Record<SLARiskLevel, string> = {
    LOW: "bg-yellow-100 text-yellow-700",
    MEDIUM: "bg-orange-100 text-orange-700",
    HIGH: "bg-red-100 text-red-700",
    CRITICAL: "bg-red-200 text-red-900",
  };
  return map[level] ?? "bg-slate-100 text-slate-700";
}

export function podStatusColor(status: PODStatus): string {
  const map: Record<PODStatus, string> = {
    PENDING: "bg-slate-100 text-slate-600",
    SUBMITTED: "bg-blue-100 text-blue-700",
    APPROVED: "bg-emerald-100 text-emerald-700",
    REJECTED: "bg-red-100 text-red-700",
  };
  return map[status] ?? "bg-slate-100 text-slate-700";
}

export function scoreColor(score: number): string {
  if (score >= 90) return "text-emerald-600";
  if (score >= 80) return "text-green-600";
  if (score >= 70) return "text-amber-600";
  return "text-red-600";
}

export function scoreBg(score: number): string {
  if (score >= 90) return "bg-emerald-50 border-emerald-200";
  if (score >= 80) return "bg-green-50 border-green-200";
  if (score >= 70) return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
}

// ─── SLA Risk recommended action ──────────────────────────────────────────────
export function getRecommendedAction(riskLevel: SLARiskLevel, reasons: RiskReason[]): string {
  const hasSpeed = reasons.some((r) => r.code === "SPEED_DROP" || r.code === "LOW_SPEED");
  const hasTraffic = reasons.some((r) => r.code === "TRAFFIC" || r.code === "ROUTE_EVENT");
  const hasStop = reasons.some((r) => r.code === "UNSCHEDULED_STOP" || r.code === "EXTENDED_HALT");

  if (riskLevel === "CRITICAL") {
    return "Immediate escalation required. Contact the transporter to reroute the vehicle or arrange an alternate transporter. Notify the receiving warehouse of the expected delay.";
  }
  if (riskLevel === "HIGH") {
    if (hasTraffic) return "Contact driver to explore alternate routes. Inform the destination warehouse of a potential delay and adjust the receiving schedule.";
    if (hasStop) return "Contact the driver immediately to understand the halt reason. If the vehicle is unable to move, initiate contingency logistics.";
    return "Escalate to the transporter operations team. Request a status update and confirm the driver is aware of the SLA deadline.";
  }
  if (riskLevel === "MEDIUM") {
    if (hasSpeed) return "Monitor vehicle speed over the next 30 minutes. If speed does not recover, contact the driver to check for road conditions or vehicle issues.";
    if (hasTraffic) return "Monitor the route event. If the estimated delay increases, contact the transporter to explore alternate routes.";
    return "Continue monitoring. If the risk level increases, escalate to the transporter.";
  }
  return "No action required at this time. The shipment is being monitored automatically.";
}
