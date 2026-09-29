import { describe, it, expect } from "vitest";
import { isEligibleForDeliveryConfirmation, deriveDeliveryOutcome } from "../rules";
import { ShipmentStatus, PODCondition } from "../../../../generated/prisma/client";

describe("isEligibleForDeliveryConfirmation — QR receiver-confirmation gate", () => {
  it("allows confirmation once the vehicle has been dispatched or is active en route", () => {
    expect(isEligibleForDeliveryConfirmation(ShipmentStatus.DISPATCHED)).toBe(true);
    expect(isEligibleForDeliveryConfirmation(ShipmentStatus.IN_TRANSIT)).toBe(true);
    expect(isEligibleForDeliveryConfirmation(ShipmentStatus.DELAYED)).toBe(true);
    expect(isEligibleForDeliveryConfirmation(ShipmentStatus.AT_RISK)).toBe(true);
  });

  it("allows confirmation once the shipment has already reached DELIVERED", () => {
    expect(isEligibleForDeliveryConfirmation(ShipmentStatus.DELIVERED)).toBe(true);
  });

  it("rejects confirmation before the vehicle has been dispatched", () => {
    expect(isEligibleForDeliveryConfirmation(ShipmentStatus.CREATED)).toBe(false);
  });

  it("rejects confirmation once the shipment is already closed out", () => {
    expect(isEligibleForDeliveryConfirmation(ShipmentStatus.COMPLETED)).toBe(false);
    expect(isEligibleForDeliveryConfirmation(ShipmentStatus.CANCELLED)).toBe(false);
  });
});

describe("deriveDeliveryOutcome — Delivery Inspection & Acceptance outcome", () => {
  const clean = { packagingDamaged: false, productIssueObserved: false, temperatureExcursion: null, isPartialDelivery: false };

  it("is GOOD with no exception when the inspection raises nothing", () => {
    expect(deriveDeliveryOutcome(clean)).toEqual({ condition: PODCondition.GOOD, hasException: false });
  });

  it("flags an exception without failing the delivery when packaging is damaged", () => {
    expect(deriveDeliveryOutcome({ ...clean, packagingDamaged: true })).toEqual({ condition: PODCondition.DAMAGED, hasException: true });
  });

  it("flags an exception when a product issue is observed", () => {
    expect(deriveDeliveryOutcome({ ...clean, productIssueObserved: true })).toEqual({ condition: PODCondition.DAMAGED, hasException: true });
  });

  it("flags an exception on a cold-chain temperature excursion", () => {
    expect(deriveDeliveryOutcome({ ...clean, temperatureExcursion: true })).toEqual({ condition: PODCondition.GOOD, hasException: true });
  });

  it("does not flag an exception when temperature is within range", () => {
    expect(deriveDeliveryOutcome({ ...clean, temperatureExcursion: false })).toEqual({ condition: PODCondition.GOOD, hasException: false });
  });

  it("marks a partial delivery as an exception with PARTIAL condition", () => {
    expect(deriveDeliveryOutcome({ ...clean, isPartialDelivery: true })).toEqual({ condition: PODCondition.PARTIAL, hasException: true });
  });

  it("prioritizes physical damage over a partial-quantity condition when both occur", () => {
    expect(deriveDeliveryOutcome({ ...clean, packagingDamaged: true, isPartialDelivery: true })).toEqual({ condition: PODCondition.DAMAGED, hasException: true });
  });
});
