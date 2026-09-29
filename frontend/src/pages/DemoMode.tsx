import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PlayCircle, RotateCcw, Sparkles, Truck, Play, Pause, TrafficCone, Construction,
  PartyPopper, Gauge, AlertTriangle, MapPinCheck, FileCheck, QrCode,
  CheckCircle2, BarChart3, ExternalLink, ClipboardList, Users,
} from "lucide-react";
import {
  startDemo, resetDemo, getDemoState, getMatchingTransporters, createShipment,
  attachDemoShipment, startDemoMovement, pauseDemoMovement, triggerDemoTrafficDelay,
  triggerDemoRoadEvent, triggerDemoFestivalEvent, recalculateDemoETA, triggerDemoSLARisk,
  moveDemoToDestination, quickConfirmDemoDelivery, approveDemoPod,
  refreshDemoKpis,
} from "@/services";
import type { DemoState, MatchResult } from "@/types";
import { Button, Card, CardHeader, CardBody, Badge, PageLoader } from "@/components/common";
import {
  shipmentStatusColor, shipmentStatusLabel, podStatusColor, podStatusLabel,
  riskLevelColor, riskLevelLabel, formatINR, formatDate, cn,
} from "@/utils";

interface LogEntry {
  id: number;
  time: string;
  message: string;
  ok: boolean;
}

function ActionButton({
  icon: Icon, label, description, onClick, busy, disabled, tone = "default",
}: {
  icon: React.ElementType; label: string; description: string; onClick: () => void;
  busy: boolean; disabled?: boolean; tone?: "default" | "warning" | "danger";
}) {
  const toneClass = {
    default: "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50",
    warning: "border-amber-200 hover:border-amber-400 hover:bg-amber-50/60",
    danger: "border-red-200 hover:border-red-400 hover:bg-red-50/60",
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        "text-left w-full p-3 rounded-xl border bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        toneClass
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center flex-shrink-0">
          {busy ? <Gauge className="w-4 h-4 text-indigo-500 animate-spin" /> : <Icon className="w-4 h-4 text-slate-500" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-800 leading-tight">{label}</p>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{description}</p>
        </div>
      </div>
    </button>
  );
}

function StepGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">{title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">{children}</div>
    </div>
  );
}

export function DemoMode() {
  const navigate = useNavigate();
  const [state, setState] = useState<DemoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<MatchResult[] | null>(null);
  const [selected, setSelected] = useState<MatchResult | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  const appendLog = (message: string, ok: boolean) => {
    setLog((prev) => [{ id: Date.now(), time: new Date().toLocaleTimeString(), message, ok }, ...prev].slice(0, 25));
  };

  const refresh = useCallback(async () => {
    try {
      const s = await getDemoState();
      setState(s);
    } catch {
      setState({ active: false });
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const run = (key: string, label: string, fn: () => Promise<unknown>) => async () => {
    setBusyKey(key);
    try {
      await fn();
      appendLog(label, true);
      await refresh();
    } catch (e: unknown) {
      appendLog(`${label} — ${e instanceof Error ? e.message : "failed"}`, false);
    } finally {
      setBusyKey(null);
    }
  };

  const handleReset = run("reset", "Demo reset to initial state", async () => {
    await resetDemo();
    setMatches(null);
    setSelected(null);
  });

  const handleStart = run("start", "Demo requirement created (CWH Ambala → Apollo Pharmacy Hub, Hyderabad)", () => startDemo());

  const handleLoadTransporters = run("load-transporters", "Loaded transporter matches", async () => {
    if (!state?.requirement) return;
    const result = await getMatchingTransporters(state.requirement.id);
    setMatches(result);
  });

  const handleCreateShipment = run("create-shipment", `Shipment created with ${selected?.transporter.name ?? "transporter"}`, async () => {
    if (!state?.requirement || !selected || !selected.eligibility.eligible) return;
    const shipment = await createShipment({
      requirementId: state.requirement.id,
      transporterId: selected.transporter.id,
      vehicleId: selected.eligibility.eligibleVehicles[0].id,
      agreedCostInr: selected.eligibility.estimatedCostInr,
    });
    await attachDemoShipment(shipment.id);
  });

  const shipment = state?.shipment ?? null;
  const shipmentId = shipment?.id;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* DEMO MODE banner */}
      <div className="rounded-2xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-500 flex items-center justify-center shadow-md shadow-amber-500/30">
              <PlayCircle className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold text-amber-900 tracking-tight">DEMO MODE</h1>
                <Badge className="bg-amber-200 text-amber-900">Presenter Tool</Badge>
              </div>
              <p className="text-sm font-medium text-amber-800/80 mt-0.5">
                One-click control panel for a reliable CWH Ambala → Hyderabad walkthrough. Every action here drives the real
                product logic and screens — this is not a separate simulation of the app.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" loading={busyKey === "reset"} onClick={handleReset} className="border-red-200 text-red-600 hover:bg-red-50">
              <RotateCcw className="w-4 h-4" /> RESET DEMO
            </Button>
            <Button loading={busyKey === "start"} onClick={handleStart} className="bg-amber-600 hover:bg-amber-700 shadow-amber-600/20">
              <Sparkles className="w-4 h-4" /> START DEMO
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <PageLoader />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: status */}
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader><h2 className="font-bold text-slate-800 text-sm">Demo Status</h2></CardHeader>
              <CardBody className="p-4 space-y-3">
                {!state?.active ? (
                  <p className="text-sm text-slate-400 italic">Not started. Click START DEMO to create the scenario.</p>
                ) : (
                  <>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Requirement</p>
                      <p className="text-sm font-bold text-slate-800">{state.requirement?.referenceNumber}</p>
                      <p className="text-xs text-slate-500">{state.requirement?.originCity} → {state.requirement?.destinationCity}</p>
                    </div>
                    {shipment && (
                      <>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Shipment</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-sm font-bold text-slate-800 font-mono">{shipment.trackingNumber}</span>
                            <Badge className={shipmentStatusColor(shipment.status)}>{shipmentStatusLabel(shipment.status)}</Badge>
                          </div>
                        </div>
                        {state.eta && (
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">ETA</p>
                            <p className="text-sm font-semibold text-slate-700">{formatDate(state.eta.estimatedArrival)}</p>
                          </div>
                        )}
                        {state.risk && (
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">SLA Risk</p>
                            <Badge className={riskLevelColor(state.risk.riskLevel)}>{riskLevelLabel(state.risk.riskLevel)}</Badge>
                          </div>
                        )}
                        {state.pod && (
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">POD</p>
                            <Badge className={podStatusColor(state.pod.status)}>{podStatusLabel(state.pod.status)}</Badge>
                          </div>
                        )}
                        <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
                          <Button variant="secondary" size="sm" onClick={() => navigate(`/shipments/${shipmentId}`)}>
                            <ExternalLink className="w-3.5 h-3.5" /> Open Shipment Screen
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => navigate(`/pod/${shipmentId}`)}>
                            <ExternalLink className="w-3.5 h-3.5" /> Open POD Screen
                          </Button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </CardBody>
            </Card>

            {/* Activity log */}
            <Card>
              <CardHeader><h2 className="font-bold text-slate-800 text-sm">Activity Log</h2></CardHeader>
              <CardBody className="p-4">
                {log.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">Actions you trigger will appear here.</p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {log.map((entry) => (
                      <div key={entry.id} className="text-xs flex items-start gap-2">
                        <span className={cn("mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0", entry.ok ? "bg-emerald-500" : "bg-red-500")} />
                        <div>
                          <p className={cn("font-medium", entry.ok ? "text-slate-700" : "text-red-600")}>{entry.message}</p>
                          <p className="text-[10px] text-slate-400">{entry.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Right: control panel */}
          <div className="lg:col-span-2 space-y-5">
            <StepGroup title="1–4 · Setup">
              <ActionButton icon={ClipboardList} label="Create/Load Demo Requirement" description="CWH Ambala → Apollo Pharmacy Hub, 2,500kg, cold chain 2–8°C"
                onClick={handleStart} busy={busyKey === "start"} />
              <ActionButton icon={Users} label="Load Demo Transporters" description="Fetch eligible/ineligible matches with KPIs and score breakdown"
                onClick={handleLoadTransporters} busy={busyKey === "load-transporters"} disabled={!state?.active} />
            </StepGroup>

            {matches && !shipment && (
              <Card className="border-indigo-100">
                <CardBody className="p-4">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">3 · Select Transporter</p>
                  <div className="space-y-2">
                    {matches.filter((m) => m.eligibility.eligible).map((m) => (
                      <button
                        key={m.transporter.id}
                        onClick={() => setSelected(m)}
                        className={cn(
                          "w-full text-left p-3 rounded-lg border flex items-center justify-between gap-3 transition-colors",
                          selected?.transporter.id === m.transporter.id
                            ? "border-indigo-400 bg-indigo-50/60"
                            : "border-slate-200 hover:border-slate-300 bg-white"
                        )}
                      >
                        <div>
                          <p className="text-sm font-bold text-slate-800">{m.transporter.name}</p>
                          <p className="text-xs text-slate-500">Score {Math.round(m.scoring?.totalScore ?? 0)}/100 · {formatINR(m.eligibility.estimatedCostInr)}</p>
                        </div>
                        {selected?.transporter.id === m.transporter.id && <CheckCircle2 className="w-5 h-5 text-indigo-500 flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                </CardBody>
              </Card>
            )}

            <StepGroup title="4 · Create Shipment">
              <ActionButton icon={Truck} label="Create Demo Shipment" description="Assigns the selected transporter's vehicle and creates the shipment"
                onClick={handleCreateShipment} busy={busyKey === "create-shipment"} disabled={!selected || !!shipment} />
            </StepGroup>

            <StepGroup title="5–6 · Movement">
              <ActionButton icon={Play} label="Start Vehicle Movement" description="Dispatches (or resumes) the GPS simulator"
                onClick={run("start-movement", "Vehicle movement started", () => startDemoMovement())} busy={busyKey === "start-movement"} disabled={!shipment} />
              <ActionButton icon={Pause} label="Pause Vehicle" description="Pauses the GPS simulator in place"
                onClick={run("pause", "Vehicle paused", () => pauseDemoMovement())} busy={busyKey === "pause"} disabled={!shipment} />
            </StepGroup>

            <StepGroup title="7–9 · Disruptions">
              <ActionButton icon={TrafficCone} label="Trigger Traffic Delay" description="Switches the vehicle to TRAFFIC mode and recalculates" tone="warning"
                onClick={run("traffic", "Traffic delay triggered", () => triggerDemoTrafficDelay())} busy={busyKey === "traffic"} disabled={!shipment} />
              <ActionButton icon={Construction} label="Trigger Road Event" description="Activates a real accident/closure event on the route corridor" tone="warning"
                onClick={run("road-event", "Road event activated", () => triggerDemoRoadEvent())} busy={busyKey === "road-event"} disabled={!shipment} />
              <ActionButton icon={PartyPopper} label="Trigger Local Event Impact" description="Activates the IPL Match disruption event near Hyderabad" tone="warning"
                onClick={run("festival-event", "Local event impact activated", () => triggerDemoFestivalEvent())} busy={busyKey === "festival-event"} disabled={!shipment} />
              <ActionButton icon={AlertTriangle} label="Trigger SLA Risk" description="Stops the vehicle and re-evaluates risk immediately" tone="danger"
                onClick={run("sla-risk", "SLA risk evaluated", () => triggerDemoSLARisk())} busy={busyKey === "sla-risk"} disabled={!shipment} />
            </StepGroup>

            <StepGroup title="10–12 · ETA & Arrival">
              <ActionButton icon={Gauge} label="Recalculate ETA" description="Forces a fresh ETA calculation from the latest position"
                onClick={run("recalc-eta", "ETA recalculated", () => recalculateDemoETA())} busy={busyKey === "recalc-eta"} disabled={!shipment} />
              <ActionButton icon={MapPinCheck} label="Move Vehicle to Destination" description="Demo-only fast-forward — skips real-time GPS travel"
                onClick={run("arrive", "Vehicle moved to destination", () => moveDemoToDestination())} busy={busyKey === "arrive"} disabled={!shipment} />
            </StepGroup>

            <StepGroup title="13–15 · Delivery & POD">
              <ActionButton icon={FileCheck} label="Open POD Screen" description="Opens the real POD screen for this shipment"
                onClick={() => shipmentId && navigate(`/pod/${shipmentId}`)} busy={false} disabled={!shipment} />
              <ActionButton icon={QrCode} label="Confirm Delivery" description="Simulates the receiver scanning the QR and tapping YES — auto-submits the POD"
                onClick={run("confirm", "Delivery confirmed — POD submitted", () => quickConfirmDemoDelivery())} busy={busyKey === "confirm"} disabled={!shipment} />
              <ActionButton icon={CheckCircle2} label="Approve POD" description="Manager approves the POD and completes the shipment"
                onClick={run("approve", "POD approved — shipment completed", () => approveDemoPod())} busy={busyKey === "approve"} disabled={!shipment} />
            </StepGroup>

            <StepGroup title="16 · Wrap-up">
              <ActionButton icon={BarChart3} label="Refresh Transporter KPIs" description="Recomputes this transporter's KPI snapshot from shipment history"
                onClick={run("kpis", "Transporter KPIs refreshed", () => refreshDemoKpis())} busy={busyKey === "kpis"} disabled={!shipment} />
            </StepGroup>
          </div>
        </div>
      )}
    </div>
  );
}
