import { describe, it, expect } from "vitest";
import { isQuotationWindowOpen } from "../rules";
import { OfferStatus } from "../../../../generated/prisma/client";

const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
const PAST = new Date(Date.now() - 60 * 60 * 1000);

describe("isQuotationWindowOpen", () => {
  it("is open for a PENDING offer with no deadline set", () => {
    expect(isQuotationWindowOpen(OfferStatus.PENDING, null)).toBe(true);
  });

  it("is open for a PENDING offer with a future deadline", () => {
    expect(isQuotationWindowOpen(OfferStatus.PENDING, FUTURE)).toBe(true);
  });

  it("is closed for a PENDING offer once the deadline has passed", () => {
    expect(isQuotationWindowOpen(OfferStatus.PENDING, PAST)).toBe(false);
  });

  it("is closed once the offer has already been submitted, even before the deadline", () => {
    expect(isQuotationWindowOpen(OfferStatus.SUBMITTED, FUTURE)).toBe(false);
  });

  it("is closed for ACCEPTED/REJECTED/WITHDRAWN regardless of deadline", () => {
    expect(isQuotationWindowOpen(OfferStatus.ACCEPTED, FUTURE)).toBe(false);
    expect(isQuotationWindowOpen(OfferStatus.REJECTED, FUTURE)).toBe(false);
    expect(isQuotationWindowOpen(OfferStatus.WITHDRAWN, FUTURE)).toBe(false);
  });
});
