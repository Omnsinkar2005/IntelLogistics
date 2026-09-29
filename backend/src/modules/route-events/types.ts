import { RouteEventSource, RouteEventType, SLARiskLevel } from "../../../generated/prisma/client";

// ─────────────────────────────────────────────────────────────────────────
// ROUTE EVENT PROVIDER — CONTRACT
//
// This interface is the swap point for real external data sources. The
// rest of the system (relevance filtering, SLA risk) only ever depends on
// `RouteEventProvider.fetchActiveEvents()` — it never depends on where the
// events came from. For this POC, the only registered provider reads a
// local mock dataset (see `providers/mockRouteEventProvider.ts`); it does
// NOT scrape the internet or call any external API. Future providers can
// wrap a real traffic API, a road-closure feed, a public-event API, a
// weather API, or a government/public data source — each implementing
// this same interface — without any other module changing.
// ─────────────────────────────────────────────────────────────────────────

export interface RouteEventBoundingBox {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

export interface RouteEventRecord {
  /**
   * Present when the event is already persisted (true today for the
   * DB-backed mock provider). A future live-API provider may omit this
   * until the event is first seen and persisted.
   */
  id?: string;
  eventType: RouteEventType;
  title: string;
  description: string;
  affectedHighway: string | null;
  affectedCity: string | null;
  affectedRegion: RouteEventBoundingBox;
  severity: SLARiskLevel;
  estimatedDelayMinutes: number;
  source: RouteEventSource;
  validFrom: Date;
  validUntil: Date;
}

export interface RouteEventQuery {
  /** Point in time to evaluate "active" against. Defaults to now. Injectable for tests. */
  now?: Date;
}

export interface RouteEventProvider {
  readonly name: string;
  readonly source: RouteEventSource;
  fetchActiveEvents(query?: RouteEventQuery): Promise<RouteEventRecord[]>;
}
