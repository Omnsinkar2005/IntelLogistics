import { mockRouteEventProvider } from "./providers/mockRouteEventProvider";
import { RouteEventProvider } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// The set of active route event providers, aggregated by the service layer.
//
// To integrate a real data source later, implement `RouteEventProvider`
// (e.g. `trafficApiRouteEventProvider`, `weatherApiRouteEventProvider`,
// `roadClosureApiRouteEventProvider`, `govDataRouteEventProvider`) and add
// it here. Relevance filtering and SLA risk calculation are unaffected —
// they only depend on the `RouteEventProvider` interface.
// ─────────────────────────────────────────────────────────────────────────
const ACTIVE_PROVIDERS: RouteEventProvider[] = [mockRouteEventProvider];

export function getRouteEventProviders(): RouteEventProvider[] {
  return ACTIVE_PROVIDERS;
}
