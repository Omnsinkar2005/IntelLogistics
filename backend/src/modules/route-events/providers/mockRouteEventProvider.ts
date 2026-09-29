import { RouteEventSource } from "../../../../generated/prisma/client";
import { prisma } from "../../../db/client";
import { RouteEventProvider, RouteEventQuery, RouteEventRecord } from "../types";

// ─────────────────────────────────────────────────────────────────────────
// MOCK ROUTE EVENT PROVIDER
//
// Reads a local, hand-curated dataset of realistic Indian logistics
// disruptions (traffic, closures, festivals, weather, etc.), persisted via
// `prisma/seed.ts` into the `route_events` table. This is simulated data
// for demo purposes only — it is NOT live traffic/event intelligence and
// does not call any external API or scrape the internet.
// ─────────────────────────────────────────────────────────────────────────

function toRecord(row: {
  id: string;
  eventType: RouteEventRecord["eventType"];
  title: string;
  description: string;
  affectedHighway: string | null;
  affectedCity: string | null;
  affectedRegion: unknown;
  severity: RouteEventRecord["severity"];
  estimatedDelayMinutes: number;
  source: RouteEventSource;
  validFrom: Date;
  validUntil: Date;
}): RouteEventRecord {
  return {
    id: row.id,
    eventType: row.eventType,
    title: row.title,
    description: row.description,
    affectedHighway: row.affectedHighway,
    affectedCity: row.affectedCity,
    affectedRegion: row.affectedRegion as RouteEventRecord["affectedRegion"],
    severity: row.severity,
    estimatedDelayMinutes: row.estimatedDelayMinutes,
    source: row.source,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
  };
}

export const mockRouteEventProvider: RouteEventProvider = {
  name: "mock-local-dataset",
  source: RouteEventSource.MOCK,

  async fetchActiveEvents(query: RouteEventQuery = {}): Promise<RouteEventRecord[]> {
    const now = query.now ?? new Date();
    const rows = await prisma.routeEvent.findMany({
      where: { source: RouteEventSource.MOCK, validFrom: { lte: now }, validUntil: { gte: now } },
      orderBy: { estimatedDelayMinutes: "desc" },
    });
    return rows.map(toRecord);
  },
};
