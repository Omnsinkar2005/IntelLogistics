import { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Truck, Clock, AlertTriangle, CheckCircle,
  Thermometer, Navigation, Zap, FileCheck, Info,
  Play, Pause, Settings2, TrafficCone, Gauge,
} from "lucide-react";
import {
  getShipment, getLatestLocation, getETA, getShipmentSLARisk,
  getShipmentRouteEvents, getShipmentTimeline, dispatchShipment,
  getSimulationState, startSimulation, pauseSimulation, setSimulationMode,
} from "@/services";
import type { Shipment, ShipmentLocation, ETASnapshot, SLARiskEvent, SLAStatus, SLARiskLevel, RouteEvent, TimelineEvent, SLA, SimulationState, SimulationMode } from "@/types";
import { Button, Card, CardHeader, CardBody, Badge, PageLoader, ErrorMessage, Divider, StatusDot } from "@/components/common";
import { LiveMap } from "@/components/map/LiveMap";
import { DeliveryQRCard } from "@/components/pod/DeliveryQRCard";
import { AssignmentNotificationCard } from "@/components/shipment/AssignmentNotificationCard";
import {
  shipmentStatusColor, shipmentStatusLabel, formatDate, formatINR,
  riskLevelColor, riskLevelLabel, minutesToHuman, slaMinutesLabel, cn, getRecommendedAction, timeAgo
} from "@/utils";

const SLA_STATUS_LABEL: Record<SLAStatus, string> = {
  ON_TRACK: "On Track", AT_RISK: "At Risk", HIGH_RISK: "High Risk", BREACH: "Breach", DELIVERED: "Delivered",
};

const IMPACT_LABEL: Record<SLARiskLevel, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };

function SLARiskPanel({ risk, routeEvents, eta, sla }: { risk: SLARiskEvent; routeEvents: RouteEvent[]; eta: ETASnapshot | null; sla: SLA | null }) {
  const recommendedAction = getRecommendedAction(risk.riskLevel, risk.reasons);

  const bgClass = risk.riskLevel === "CRITICAL" || risk.riskLevel === "HIGH" ? "bg-red-50 border-red-200" : "bg-orange-50 border-orange-200";
  const iconClass = risk.riskLevel === "CRITICAL" || risk.riskLevel === "HIGH" ? "text-red-500 bg-red-100" : "text-orange-500 bg-orange-100";
  const textClass = risk.riskLevel === "CRITICAL" || risk.riskLevel === "HIGH" ? "text-red-900" : "text-orange-900";

  return (
    <Card className={cn("border shadow-sm animate-fade-in-up", bgClass)}>
      <CardBody className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={cn("w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0", iconClass)}>
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className={cn("font-bold text-lg", textClass)}>SLA Risk Detected</h3>
                <Badge className={riskLevelColor(risk.riskLevel)}>{risk.status ? SLA_STATUS_LABEL[risk.status] : riskLevelLabel(risk.riskLevel)}</Badge>
              </div>
              <p className={cn("text-sm font-medium mt-0.5", textClass, "opacity-80")}>
                {risk.predictedDelayMinutes > 0
                  ? `Shipment is predicted to breach SLA by approximately ${minutesToHuman(risk.predictedDelayMinutes)}.`
                  : "Shipment risk has been elevated by active disruptions — current ETA is still within the SLA window."}
              </p>
              {risk.confidence && (
                <p className={cn("text-xs mt-1", textClass, "opacity-60")} title={risk.confidenceReason}>
                  {risk.confidence} confidence
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 4 Metric Cards */}
        <div className="grid grid-cols-4 gap-4 mb-5">
          <div className="bg-white/60 rounded-lg p-3 border border-white/40">
            <p className="text-xs font-semibold uppercase tracking-wider opacity-70">Predicted Delay</p>
            <p className="text-xl font-bold mt-1 text-red-600">{minutesToHuman(risk.predictedDelayMinutes)}</p>
          </div>
          <div className="bg-white/60 rounded-lg p-3 border border-white/40">
            <p className="text-xs font-semibold uppercase tracking-wider opacity-70">SLA Buffer</p>
            <p className="text-xl font-bold mt-1 text-slate-800">{slaMinutesLabel(risk.bufferMinutes)}</p>
          </div>
          <div className="bg-white/60 rounded-lg p-3 border border-white/40">
            <p className="text-xs font-semibold uppercase tracking-wider opacity-70">Current ETA</p>
            <p className="text-lg font-bold mt-1 text-slate-800">{eta ? formatDate(eta.estimatedArrival).split(",")[1].trim() : "—"}</p>
            <p className="text-[10px] text-slate-500">{eta ? formatDate(eta.estimatedArrival).split(",")[0] : ""}</p>
          </div>
          <div className="bg-white/60 rounded-lg p-3 border border-white/40">
            <p className="text-xs font-semibold uppercase tracking-wider opacity-70">SLA Deadline</p>
            <p className="text-lg font-bold mt-1 text-slate-800">{sla ? formatDate(sla.deadline).split(",")[1].trim() : "—"}</p>
            <p className="text-[10px] text-slate-500">{sla ? formatDate(sla.deadline).split(",")[0] : ""}</p>
          </div>
        </div>

        {routeEvents.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-wider opacity-70 mb-2">Route Event Detected</p>
            <div className="space-y-2">
              {routeEvents.map((e) => (
                <div key={e.id} className="bg-white/80 rounded-lg px-3 py-2.5 border border-black/5 shadow-sm">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800">{e.title}</p>
                      <div className="grid grid-cols-3 gap-2 mt-1.5">
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-slate-400">Location</p>
                          <p className="text-xs font-medium text-slate-700">{e.affectedCity ?? "—"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-slate-400">Expected impact</p>
                          <Badge className={riskLevelColor(e.severity)}>{IMPACT_LABEL[e.severity]}</Badge>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-slate-400">Estimated delay</p>
                          <p className="text-xs font-medium text-amber-600">{e.estimatedDelayMinutes} minutes</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">
              Based on a local mock event dataset for this POC — not live traffic or event data.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Reasons */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider opacity-70 mb-2">Risk Factors</p>
            <div className="space-y-2">
              {risk.reasons.map((r) => (
                <div key={r.code} className="flex items-start gap-2 bg-white/80 rounded-lg px-3 py-2 border border-black/5 shadow-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0 mt-1.5" />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{r.description}</p>
                    {r.impactMinutes > 0 && (
                      <p className="text-xs text-red-500 font-medium">+{minutesToHuman(r.impactMinutes)} delay impact</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recommended Action */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider opacity-70 mb-2">Recommended Action</p>
            <div className="bg-white/80 rounded-lg p-4 border border-black/5 shadow-sm h-full">
              <div className="flex gap-2">
                <Info className="w-5 h-5 text-indigo-500 flex-shrink-0" />
                <p className="text-sm text-slate-700 leading-relaxed font-medium">
                  {recommendedAction}
                </p>
              </div>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function ShipmentTimeline({ events }: { events: TimelineEvent[] }) {
  const iconMap: Record<string, React.ElementType> = {
    STATUS: CheckCircle, ROUTE_EVENT: AlertTriangle, SLA_RISK: Zap, POD: FileCheck,
  };
  const colorMap: Record<string, string> = {
    STATUS: "bg-blue-100 text-blue-600",
    ROUTE_EVENT: "bg-amber-100 text-amber-600",
    SLA_RISK: "bg-red-100 text-red-600",
    POD: "bg-emerald-100 text-emerald-600",
  };
  return (
    <div className="space-y-4">
      {events.map((e, i) => {
        const Icon = iconMap[e.type] ?? CheckCircle;
        const isLast = i === events.length - 1;
        return (
          <div key={i} className="flex gap-4 relative">
            {!isLast && <div className="absolute left-4 top-8 bottom-0 w-px bg-slate-200 -ml-px" />}
            <div className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 z-10 shadow-sm border border-white", colorMap[e.type] ?? "bg-slate-100 text-slate-500")}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0 pt-1 pb-3">
              <p className="text-sm font-bold text-slate-900">{e.title}</p>
              {e.detail && <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{e.detail}</p>}
              <p className="text-[11px] text-slate-400 mt-1 font-medium tracking-wide">{formatDate(e.time)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ShipmentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [location, setLocation] = useState<ShipmentLocation | null>(null);
  const [eta, setEta] = useState<ETASnapshot | null>(null);
  const [risk, setRisk] = useState<SLARiskEvent | null>(null);
  const [routeEvents, setRouteEvents] = useState<RouteEvent[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [simState, setSimState] = useState<SimulationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [s, loc, etaData, riskData, events, tl, sim] = await Promise.all([
        getShipment(id),
        getLatestLocation(id).catch(() => null),
        getETA(id).catch(() => null),
        getShipmentSLARisk(id).catch(() => null),
        getShipmentRouteEvents(id).catch(() => []),
        getShipmentTimeline(id).catch(() => ({ shipment: null, events: [] })),
        getSimulationState(id).catch(() => null),
      ]);
      setShipment(s);
      setLocation(loc);
      setEta(etaData);
      setRisk(riskData?.activeRisk ?? null);
      setRouteEvents(events);
      setTimeline(tl.events);
      setSimState(sim);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load shipment");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleDispatch = async () => {
    if (!id) return;
    try {
      setDispatching(true);
      await dispatchShipment(id);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to dispatch");
    } finally {
      setDispatching(false);
    }
  };

  const handleSimStart = async () => {
    if (!id) return;
    await startSimulation(id);
    await load();
  };

  const handleSimPause = async () => {
    if (!id) return;
    await pauseSimulation(id);
    await load();
  };

  const handleSimMode = async (mode: SimulationMode) => {
    if (!id) return;
    await setSimulationMode(id, mode);
    await load();
  };

  if (loading) return <PageLoader />;
  if (error) return <ErrorMessage message={error} onRetry={load} />;
  if (!shipment) return null;

  const sla = shipment.sla ?? null;
  const now = new Date();
  const minsToSla = sla ? (new Date(sla.deadline).getTime() - now.getTime()) / 60_000 : null;
  const isActive = ["DISPATCHED", "IN_TRANSIT", "DELAYED", "AT_RISK"].includes(shipment.status);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate("/shipments")} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl font-extrabold text-slate-900 font-mono tracking-tight">{shipment.trackingNumber}</h1>
              <Badge className={shipmentStatusColor(shipment.status)}>{shipmentStatusLabel(shipment.status)}</Badge>
              {isActive && <StatusDot color={shipment.status === "AT_RISK" || shipment.status === "DELAYED" ? "amber" : "blue"} pulse />}
            </div>
            <p className="text-sm font-medium text-slate-500 mt-1">
              {shipment.originFacility?.name ?? shipment.originCity} <span className="mx-1 text-slate-300">→</span> {shipment.destinationFacility?.name ?? shipment.destinationCity}
              <span className="mx-2 text-slate-300">|</span>
              <span className="text-slate-600">{shipment.transporter?.name}</span>
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          {shipment.status === "CREATED" && (
            <Button loading={dispatching} onClick={handleDispatch}>
              <Truck className="w-4 h-4" /> Dispatch Shipment
            </Button>
          )}
          <Button variant="secondary" onClick={() => navigate(`/pod/${shipment.id}`)}>
            <FileCheck className="w-4 h-4" /> View POD
          </Button>
        </div>
      </div>

      {/* SLA Risk Banner */}
      {risk && <SLARiskPanel risk={risk} routeEvents={routeEvents} eta={eta} sla={sla} />}

      {/* Live Map & Simulator Controls */}
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        {isActive && (
          <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded bg-indigo-100 text-indigo-700">
                <Settings2 className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">GPS Simulator</p>
                <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                  {simState ? `Status: ${simState.status}` : "Status: IDLE"}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {simState?.status === "RUNNING" ? (
                <Button size="sm" variant="secondary" onClick={handleSimPause}>
                  <Pause className="w-3.5 h-3.5 mr-1" /> Pause
                </Button>
              ) : (
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSimStart}>
                  <Play className="w-3.5 h-3.5 mr-1 text-white fill-white" /> {simState ? "Resume" : "Start"}
                </Button>
              )}
              
              <div className="h-6 w-px bg-slate-300 mx-2" />
              
              <div className="flex bg-white border border-slate-200 rounded-lg p-0.5 shadow-sm overflow-hidden">
                {(["NORMAL", "REDUCED", "TRAFFIC", "STOPPED"] as SimulationMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => handleSimMode(mode)}
                    disabled={simState?.status !== "RUNNING"}
                    className={cn(
                      "px-3 py-1.5 text-[11px] font-bold tracking-wider rounded transition-colors disabled:opacity-50",
                      simState?.mode === mode
                        ? "bg-indigo-50 text-indigo-700 shadow-sm border border-indigo-100"
                        : "text-slate-500 hover:text-slate-700 hover:bg-slate-50 border border-transparent"
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        <LiveMap
          originLat={Number(shipment.originLat)}
          originLng={Number(shipment.originLng)}
          destLat={Number(shipment.destinationLat)}
          destLng={Number(shipment.destinationLng)}
          currentLocation={location}
          routePolyline={shipment.routePolyline}
          routeEvents={routeEvents}
          className="h-[350px] w-full"
        />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left col */}
        <div className="lg:col-span-2 space-y-6">
          {/* ETA + SLA cards */}
          <div className="grid grid-cols-2 gap-5">
            <Card>
              <CardBody>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-indigo-500" />
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Estimated Arrival</p>
                </div>
                {eta ? (
                  <>
                    <p className="text-2xl font-extrabold text-slate-900">{formatDate(eta.estimatedArrival)}</p>
                    <div className="flex items-center justify-between mt-3">
                      <p className="text-sm font-medium text-slate-600">
                        {eta.minutesToEta !== undefined ? minutesToHuman(eta.minutesToEta) + " away" : ""}
                      </p>
                      <div className={cn("text-xs font-bold px-2.5 py-1 rounded-md", eta.onTrack ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                        {eta.onTrack ? "On Track" : "Behind Schedule"}
                      </div>
                    </div>
                    {eta.confidence && (
                      <p
                        className={cn(
                          "text-[11px] font-medium mt-2",
                          eta.confidence === "HIGH" ? "text-slate-400" :
                          eta.confidence === "MEDIUM" ? "text-amber-600" : "text-red-600"
                        )}
                        title={eta.confidenceReason}
                      >
                        {eta.confidence} confidence{eta.status ? ` · ${eta.status.replace("_", " ").toLowerCase()}` : ""}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-slate-400 mt-1 italic">Awaiting first GPS update</p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-indigo-500" />
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">SLA Deadline</p>
                </div>
                {sla ? (
                  <>
                    <p className="text-2xl font-extrabold text-slate-900">{formatDate(sla.deadline)}</p>
                    <div className="flex items-center justify-between mt-3">
                      <p className={cn("text-sm font-bold", minsToSla !== null && minsToSla < 120 ? "text-red-600" : "text-slate-500")}>
                        {minsToSla !== null
                          ? minsToSla > 0
                            ? `${minutesToHuman(minsToSla)} buffer`
                            : `${minutesToHuman(Math.abs(minsToSla))} overdue`
                          : ""}
                      </p>
                      {sla.isBreached && <Badge className="bg-red-100 text-red-700">BREACHED</Badge>}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-400 mt-1">—</p>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Live vehicle status */}
          {location && (
            <Card>
              <CardBody>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <Navigation className="w-4 h-4 text-indigo-500" /> Live Vehicle Telemetry
                  </p>
                  <p className="text-[10px] font-medium text-slate-400 bg-slate-100 px-2 py-1 rounded">
                    Source: {location.source}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-6">
                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                    <p className="text-xs font-medium text-slate-500 mb-1">Speed</p>
                    <p className="text-xl font-bold text-slate-800">
                      {location.speedKmh ? `${parseFloat(location.speedKmh).toFixed(0)} km/h` : "—"}
                    </p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                    <p className="text-xs font-medium text-slate-500 mb-1">Distance Remaining</p>
                    <p className="text-xl font-bold text-slate-800">
                      {eta ? `${parseFloat(eta.distanceRemainingKm).toFixed(0)} km` : "—"}
                    </p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                    <p className="text-xs font-medium text-slate-500 mb-1">Last Update</p>
                    <p className="text-sm font-bold text-slate-800 mt-1 truncate">
                      {timeAgo(location.recordedAt)}
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {/* Shipment details */}
          <Card>
            <CardHeader><h2 className="font-bold text-slate-800 text-lg">Shipment Details</h2></CardHeader>
            <CardBody>
              <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                {[
                  ["Source", shipment.originFacility?.name ?? `${shipment.originCity}, ${shipment.originState}`],
                  ["Destination", shipment.destinationFacility?.name ?? `${shipment.destinationCity}, ${shipment.destinationState}`],
                  ["Transporter", shipment.transporter?.name ?? "—"],
                  ["Vehicle", <span className="font-mono text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">{shipment.vehicle?.vehicleNumber ?? "—"}</span>],
                  ["Driver Name", shipment.vehicle?.driverName ?? "—"],
                  ["Driver Phone", shipment.vehicle?.driverPhone ?? "—"],
                  ["Agreed Cost", formatINR(shipment.agreedCostInr)],
                  ["Total Distance", shipment.distanceKm ? `${parseFloat(shipment.distanceKm).toFixed(0)} km` : "—"],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
                    <div className="text-sm font-semibold text-slate-800">{value}</div>
                  </div>
                ))}
              </div>
              
              {shipment.destinationFacility && (
                <>
                  <Divider />
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Receiver Organisation</p>
                      <p className="text-sm font-semibold text-slate-800">
                        {shipment.destinationFacility.organizationName ?? shipment.destinationFacility.name}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Destination Address</p>
                      <p className="text-sm font-semibold text-slate-800">{shipment.destinationFacility.address ?? "—"}</p>
                    </div>
                  </div>
                </>
              )}

              {shipment.requirement && (
                <>
                  <Divider />
                  <div className="grid grid-cols-3 gap-6">
                    <div>
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Product</p>
                      <p className="text-sm font-semibold text-slate-800">{shipment.requirement.productType}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Weight</p>
                      <p className="text-sm font-semibold text-slate-800">
                        {parseFloat(shipment.requirement.weightKg).toLocaleString("en-IN")} kg
                      </p>
                    </div>
                    {shipment.requirement.coldChainRequired && (
                      <div>
                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Cold Chain</p>
                        <p className="text-sm font-bold text-cyan-600 flex items-center gap-1.5 bg-cyan-50 w-fit px-2 py-0.5 rounded border border-cyan-100">
                          <Thermometer className="w-3.5 h-3.5" /> Required
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardBody>
          </Card>

          {shipment.assignmentToken && (
            <AssignmentNotificationCard assignmentToken={shipment.assignmentToken} />
          )}

          {shipment.status !== "CREATED" && shipment.status !== "CANCELLED" && shipment.pod?.qrToken && (
            <DeliveryQRCard qrToken={shipment.pod.qrToken} />
          )}
        </div>

        {/* Right col: Timeline */}
        <Card className="h-fit">
          <CardHeader><h2 className="font-bold text-slate-800 text-lg">Event Timeline</h2></CardHeader>
          <CardBody className="p-6">
            {timeline.length === 0 ? (
              <div className="text-center py-8">
                <Clock className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-sm text-slate-500 font-medium">No events recorded yet</p>
              </div>
            ) : (
              <ShipmentTimeline events={timeline} />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
