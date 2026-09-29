import { describe, it, expect } from "vitest";
import {
  CreateRequirementSchema,
  UpdateRequirementSchema,
  SendForQuotationSchema,
  STATUS_TRANSITIONS,
} from "../service";
import { RequirementStatus } from "../../../../generated/prisma/client";

const COMPLETE_FIELDS = {
  originFacilityId: "fac_origin",
  destinationFacilityId: "fac_dest",
  productType: "Vaccines",
  weightKg: 2500,
  maxCostInr: 75000,
  slaDeadline: "2026-01-01T00:00:00.000Z",
};

// ─── CreateRequirementSchema: Draft vs. Ready to Send ──────────────────────

describe("CreateRequirementSchema — saving an incomplete form as Draft", () => {
  it("accepts an empty form when saveAsDraft is true", () => {
    const result = CreateRequirementSchema.safeParse({
      companyId: "co_1",
      createdById: "user_1",
      saveAsDraft: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a partially-filled form when saveAsDraft is true", () => {
    const result = CreateRequirementSchema.safeParse({
      companyId: "co_1",
      createdById: "user_1",
      saveAsDraft: true,
      originFacilityId: "fac_origin",
      productType: "Vaccines",
      // weightKg, maxCostInr, slaDeadline, destinationFacilityId all omitted
    });
    expect(result.success).toBe(true);
  });
});

describe("CreateRequirementSchema — a complete, unsent form is Ready to Send, never auto-sent", () => {
  it("accepts a fully-filled form with saveAsDraft omitted (defaults to false)", () => {
    const result = CreateRequirementSchema.safeParse({
      companyId: "co_1",
      createdById: "user_1",
      ...COMPLETE_FIELDS,
    });
    expect(result.success).toBe(true);
    // There is no "status" field on the input at all — the caller can only
    // ever request DRAFT or (via completeness) READY_TO_SEND. Sending is a
    // separate action (see the STATUS_TRANSITIONS tests below).
    if (result.success) {
      expect("status" in result.data).toBe(false);
      expect(result.data.saveAsDraft).toBe(false);
    }
  });

  it("rejects a non-draft submission missing required fields, with one issue per missing field", () => {
    const result = CreateRequirementSchema.safeParse({
      companyId: "co_1",
      createdById: "user_1",
      // saveAsDraft omitted -> defaults to false -> full validation applies
      productType: "Vaccines",
      // originFacilityId, destinationFacilityId, weightKg, maxCostInr, slaDeadline all missing
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toEqual(
        expect.arrayContaining([
          "originFacilityId",
          "destinationFacilityId",
          "weightKg",
          "maxCostInr",
          "slaDeadline",
        ])
      );
      expect(paths).not.toContain("productType");
    }
  });

  it("rejects saveAsDraft: false explicitly with an incomplete form", () => {
    const result = CreateRequirementSchema.safeParse({
      companyId: "co_1",
      createdById: "user_1",
      saveAsDraft: false,
      productType: "Vaccines",
    });
    expect(result.success).toBe(false);
  });
});

describe("CreateRequirementSchema — cold chain and required top-level fields", () => {
  it("still requires companyId/createdById even for a draft", () => {
    const result = CreateRequirementSchema.safeParse({ saveAsDraft: true });
    expect(result.success).toBe(false);
  });

  it("defaults coldChainRequired to false when omitted", () => {
    const result = CreateRequirementSchema.safeParse({
      companyId: "co_1",
      createdById: "user_1",
      ...COMPLETE_FIELDS,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.coldChainRequired).toBe(false);
  });
});

// ─── UpdateRequirementSchema: same completeness rules, no company/creator ──

describe("UpdateRequirementSchema — completing or editing a Draft/Ready to Send requirement", () => {
  it("accepts a partial edit when saveAsDraft is true", () => {
    const result = UpdateRequirementSchema.safeParse({ saveAsDraft: true, productType: "Insulin" });
    expect(result.success).toBe(true);
  });

  it("requires the full field set once the caller marks it Ready to Send", () => {
    const result = UpdateRequirementSchema.safeParse({ productType: "Insulin" });
    expect(result.success).toBe(false);
  });

  it("accepts a complete edit with saveAsDraft omitted", () => {
    const result = UpdateRequirementSchema.safeParse(COMPLETE_FIELDS);
    expect(result.success).toBe(true);
  });

  it("does not accept companyId/createdById (immutable, not part of this schema)", () => {
    const parsed = UpdateRequirementSchema.safeParse({ saveAsDraft: true, companyId: "co_1" });
    // Unknown keys are stripped by default zod object parsing, not rejected —
    // assert the parsed data never carries them through to the service layer.
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as Record<string, unknown>).companyId).toBeUndefined();
    }
  });
});

// ─── SendForQuotationSchema: manager selects transporters + a deadline ─────

describe("SendForQuotationSchema — selecting transporters and a quotation deadline", () => {
  it("accepts one or more transporter ids and a future-looking ISO deadline", () => {
    const result = SendForQuotationSchema.safeParse({
      transporterIds: ["t_1", "t_2"],
      quotationDeadline: "2026-06-01T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty transporter selection", () => {
    const result = SendForQuotationSchema.safeParse({
      transporterIds: [],
      quotationDeadline: "2026-06-01T12:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("requires quotationDeadline as an ISO datetime string", () => {
    const result = SendForQuotationSchema.safeParse({
      transporterIds: ["t_1"],
      quotationDeadline: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("requires transporterIds to be present", () => {
    const result = SendForQuotationSchema.safeParse({
      quotationDeadline: "2026-06-01T12:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

// ─── Status transition table ───────────────────────────────────────────────

describe("STATUS_TRANSITIONS — the five-status requirement lifecycle", () => {
  it("Draft can move to Ready to Send or be cancelled, but never straight to Sent for Quotation", () => {
    expect(STATUS_TRANSITIONS.DRAFT).toEqual(
      expect.arrayContaining([RequirementStatus.READY_TO_SEND, RequirementStatus.CANCELLED])
    );
    expect(STATUS_TRANSITIONS.DRAFT).not.toContain(RequirementStatus.OPEN);
  });

  it("Ready to Send can be sent (-> OPEN / Sent for Quotation), reverted to Draft, or cancelled", () => {
    expect(STATUS_TRANSITIONS.READY_TO_SEND).toEqual(
      expect.arrayContaining([RequirementStatus.OPEN, RequirementStatus.DRAFT, RequirementStatus.CANCELLED])
    );
  });

  it("Sent for Quotation (OPEN) can only move to Quotations Received (MATCHED) or Cancelled", () => {
    expect(STATUS_TRANSITIONS.OPEN).toEqual(
      expect.arrayContaining([RequirementStatus.MATCHED, RequirementStatus.CANCELLED])
    );
    expect(STATUS_TRANSITIONS.OPEN).not.toContain(RequirementStatus.ASSIGNED);
  });

  it("Quotations Received (MATCHED) can move to Transporter Assigned (ASSIGNED)", () => {
    expect(STATUS_TRANSITIONS.MATCHED).toContain(RequirementStatus.ASSIGNED);
  });

  it("Transporter Assigned and Cancelled are terminal", () => {
    expect(STATUS_TRANSITIONS.ASSIGNED).toEqual([]);
    expect(STATUS_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it("every RequirementStatus value has an entry in the transition table", () => {
    const allStatuses: RequirementStatus[] = [
      RequirementStatus.DRAFT,
      RequirementStatus.READY_TO_SEND,
      RequirementStatus.OPEN,
      RequirementStatus.MATCHED,
      RequirementStatus.ASSIGNED,
      RequirementStatus.CANCELLED,
    ];
    for (const s of allStatuses) {
      expect(STATUS_TRANSITIONS[s]).toBeDefined();
    }
  });
});
