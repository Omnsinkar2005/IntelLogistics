import { ShipmentStatus, PODCondition } from "../../../generated/prisma/client";

// Shipment states in which the vehicle is considered dispatched/active/at
// (or past) the destination, and a receiver's delivery confirmation can
// legitimately be accepted. Excludes CREATED (not yet dispatched) and the
// terminal COMPLETED/CANCELLED states.
const DELIVERY_ELIGIBLE_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.DISPATCHED,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.DELAYED,
  ShipmentStatus.AT_RISK,
  ShipmentStatus.DELIVERED,
];

export function isEligibleForDeliveryConfirmation(status: ShipmentStatus): boolean {
  return DELIVERY_ELIGIBLE_STATUSES.includes(status);
}

export interface DeliveryInspectionAnswers {
  packagingDamaged: boolean;
  productIssueObserved: boolean;
  // null when the shipment isn't cold-chain — the receiver is never asked.
  temperatureExcursion: boolean | null;
  isPartialDelivery: boolean;
}

export interface DeliveryOutcome {
  condition: PODCondition;
  hasException: boolean;
}

/**
 * Turns the receiver's Delivery Inspection & Acceptance answers into the
 * overall POD condition + an exception flag. An issue is recorded as an
 * exception, never treated as an automatic failure — the POD still reaches
 * SUBMITTED and a manager reviews it. Priority when multiple issues are
 * present: physical damage outranks a partial-quantity delivery.
 */
export function deriveDeliveryOutcome(answers: DeliveryInspectionAnswers): DeliveryOutcome {
  const hasException =
    answers.packagingDamaged ||
    answers.productIssueObserved ||
    answers.temperatureExcursion === true ||
    answers.isPartialDelivery;

  const condition: PODCondition =
    answers.packagingDamaged || answers.productIssueObserved
      ? PODCondition.DAMAGED
      : answers.isPartialDelivery
        ? PODCondition.PARTIAL
        : PODCondition.GOOD;

  return { condition, hasException };
}
