import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Truck, AlertTriangle, Zap, CheckCircle, FileCheck, TrendingUp, ArrowRight } from "lucide-react";
import { getDashboardSummary, getShipments } from "@/services";
import type { DashboardSummary, Shipment } from "@/types";
import { StatCard, Card, CardHeader, CardBody, Badge, PageLoader, ErrorMessage, ScoreBar, Button, StatusDot } from "@/components/common";
import { DashboardMap } from "@/components/map/DashboardMap";
import { riskLevelColor, riskLevelLabel, scoreColor } from "@/utils";

export function Dashboard() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [activeShipments, setActiveShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [summary, shipments] = await Promise.all([
        getDashboardSummary(),
        getShipments() // Fetch all to get active ones for the map
      ]);
      setData(summary);
      setActiveShipments(shipments.filter(s => ["DISPATCHED", "IN_TRANSIT", "DELAYED", "AT_RISK"].includes(s.status)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <PageLoader />;
  if (error) return <ErrorMessage message={error} onRetry={load} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Operations Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Live overview of your pharma logistics operations</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => navigate("/requirements/new")}>
            + New Requirement
          </Button>
          <Button onClick={() => navigate("/shipments")}>
            View Shipments
          </Button>
        </div>
      </div>

      {/* Stats - 5 Columns for Key Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard 
          label="Active Shipments" 
          value={data.shipments.active} 
          icon={Truck} 
          color="blue" 
          sub="Currently in transit"
          onClick={() => navigate("/shipments")}
        />
        <StatCard 
          label="At Risk" 
          value={data.shipments.atRisk} 
          icon={AlertTriangle} 
          color="amber" 
          sub="Requires attention"
          onClick={() => navigate("/shipments")}
        />
        <StatCard 
          label="Delayed / Breach" 
          value={data.shipments.delayed} 
          icon={Zap} 
          color="red" 
          sub="SLA impacted"
          onClick={() => navigate("/shipments")}
        />
        <StatCard 
          label="Delivered Today" 
          value={data.shipments.deliveredToday} 
          icon={CheckCircle} 
          color="green" 
          sub="Successfully completed"
          onClick={() => navigate("/shipments")}
        />
        <StatCard 
          label="Pending PODs" 
          value={data.pod.pendingReview} 
          icon={FileCheck} 
          color="purple" 
          sub="Awaiting approval"
          onClick={() => navigate("/pod")}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Map & Transporters (Takes up 2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                  Live Active Shipments
                  {activeShipments.length > 0 && <StatusDot pulse color="blue" />}
                </h2>
              </div>
              <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
                {activeShipments.length} on map
              </span>
            </CardHeader>
            <CardBody className="p-0">
              <DashboardMap 
                shipments={activeShipments} 
                onShipmentClick={(id) => navigate(`/shipments/${id}`)}
                className="h-[350px] rounded-none rounded-b-xl border-none"
              />
            </CardBody>
          </Card>

          {/* Transporter Performance */}
          <Card hover>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-indigo-500" />
                  Transporter Performance
                </h2>
                <button
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition-colors"
                  onClick={() => navigate("/transporters")}
                >
                  View all <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {data.topTransporters.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-sm text-slate-400">
                  No performance data available
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.topTransporters.map((t, i) => (
                    <div
                      key={t.transporter.id}
                      className="px-5 py-4 hover:bg-slate-50/80 cursor-pointer transition-colors"
                      onClick={() => navigate(`/transporters/${t.transporter.id}`)}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500">
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-sm font-bold text-slate-900 truncate">{t.transporter.name}</p>
                            <span className={`text-sm font-bold ${scoreColor(parseFloat(t.compositeScore))}`}>
                              {parseFloat(t.compositeScore).toFixed(0)}/100
                            </span>
                          </div>
                          <ScoreBar score={parseFloat(t.compositeScore)} />
                          <p className="text-[11px] text-slate-500 mt-1.5 font-medium tracking-wide">
                            OTIF: <span className="text-slate-700">{parseFloat(t.otifPercent).toFixed(1)}%</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right Column: Active Risks */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="h-full border-red-100/50 shadow-sm shadow-red-500/5">
            <CardHeader className="bg-red-50/30">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  Active SLA Risks
                </h2>
                <Badge className={data.activeRisks.length > 0 ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500"}>
                  {data.activeRisks.length} active
                </Badge>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {data.activeRisks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center px-4">
                  <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center mb-2">
                    <CheckCircle className="w-5 h-5 text-emerald-500" />
                  </div>
                  <p className="text-sm font-medium text-slate-600">All shipments on track</p>
                  <p className="text-xs text-slate-400 mt-1">No active SLA risks detected</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.activeRisks.map((risk) => (
                    <div
                      key={risk.id}
                      className="px-5 py-4 hover:bg-slate-50 cursor-pointer transition-colors group"
                      onClick={() => navigate(`/shipments/${risk.shipment.id}`)}
                    >
                      <div className="flex flex-col gap-2.5">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-sm font-bold text-slate-900 font-mono tracking-tight group-hover:text-indigo-600 transition-colors">
                              {risk.shipment.trackingNumber}
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5 truncate max-w-[180px]">
                              {risk.shipment.transporter.name}
                            </p>
                          </div>
                          <Badge className={riskLevelColor(risk.riskLevel)}>
                            {riskLevelLabel(risk.riskLevel)}
                          </Badge>
                        </div>
                        <div className="bg-slate-50 rounded px-2.5 py-1.5 border border-slate-100">
                          <p className="text-[11px] font-medium text-slate-600 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                            {risk.shipment.originCity} <ArrowRight className="w-3 h-3 text-slate-400" /> {risk.shipment.destinationCity}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
