import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Snowflake, TrendingUp, BarChart3 } from "lucide-react";
import { getTransporters, getTransporterPerformance, getKPIBreakdown } from "@/services";
import type { Transporter, TransporterKPI, KPIBreakdown } from "@/types";
import {
  PageHeader, Card, CardHeader, CardBody, Badge, Table, Th, Td,
  PageLoader, ErrorMessage, EmptyState, ScoreBar, KPIPill,
} from "@/components/common";
import { scoreColor, scoreBg, cn } from "@/utils";
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip } from "recharts";

// ─── Null-safe formatting helpers ──────────────────────────────────────────────
// KPI values are `null` when the engine didn't have enough shipment history
// to compute them for the period — shown as "Unavailable", never as 0%.

function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isNaN(n) ? null : n;
}

function fmtPct(v: string | number | null | undefined): string {
  const n = toNum(v);
  return n === null ? "Unavailable" : `${n.toFixed(1)}%`;
}

function fmtHours(v: string | number | null | undefined): string {
  const n = toNum(v);
  return n === null ? "Unavailable" : `${n.toFixed(1)}h`;
}

export function Transporters() {
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      setTransporters(await getTransporters());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load transporters");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="Transporters" subtitle="Registered transporters and their performance history" />
      <Card>
        {loading ? <PageLoader /> : error ? <ErrorMessage message={error} onRetry={load} /> : transporters.length === 0 ? (
          <EmptyState title="No transporters" description="No transporters are registered yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Transporter</Th>
                <Th>Location</Th>
                <Th>Cold Chain</Th>
                <Th>Vehicles</Th>
                <Th>Shipments</Th>
                <Th>Score</Th>
                <Th>OTIF</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {transporters.map((t) => {
                const kpi = t.kpis?.[0];
                const score = toNum(kpi?.compositeScore);
                const otif = toNum(kpi?.otifPercent);
                return (
                  <tr key={t.id} className="hover:bg-slate-50/80 cursor-pointer transition-colors group" onClick={() => navigate(`/transporters/${t.id}`)}>
                    <Td>
                      <p className="font-bold text-slate-900">{t.name}</p>
                    </Td>
                    <Td className="text-slate-500 font-medium text-sm">{t.city}, {t.state}</Td>
                    <Td>
                      {t.coldChainCapable
                        ? <Badge className="bg-cyan-50 border border-cyan-100 text-cyan-700"><Snowflake className="w-3 h-3" /> Yes</Badge>
                        : <span className="text-xs text-slate-400 italic">No</span>}
                    </Td>
                    <Td className="font-medium text-slate-700">{t._count?.vehicles ?? "—"}</Td>
                    <Td className="font-medium text-slate-700">{t._count?.shipments ?? "—"}</Td>
                    <Td>
                      {score !== null ? (
                        <div className="flex items-center gap-3 min-w-[120px]">
                          <span className={cn("text-sm font-extrabold", scoreColor(score))}>{score.toFixed(0)}</span>
                          <ScoreBar score={score} />
                        </div>
                      ) : <span className="text-xs text-slate-400 italic">No data</span>}
                    </Td>
                    <Td>
                      {otif !== null ? (
                        <span className={cn("text-sm font-bold", scoreColor(otif))}>{otif.toFixed(1)}%</span>
                      ) : <span className="text-xs text-slate-400 italic">Unavailable</span>}
                    </Td>
                    <Td><span className="text-xs text-indigo-600 font-bold group-hover:underline">View</span></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

export function TransporterDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<{ transporter: Transporter; kpis: TransporterKPI[] } | null>(null);
  const [breakdown, setBreakdown] = useState<KPIBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const result = await getTransporterPerformance(id);
      setData(result);
      const latestPeriod = result.kpis[0]?.period;
      if (latestPeriod) {
        getKPIBreakdown(id, latestPeriod).then((b) => setBreakdown(b.result)).catch(() => setBreakdown(null));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load performance");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  if (loading) return <PageLoader />;
  if (error) return <ErrorMessage message={error} onRetry={load} />;
  if (!data) return null;

  const { transporter, kpis } = data;
  const latestKpi = kpis[0];
  const score = toNum(latestKpi?.compositeScore);

  const radarData = latestKpi ? [
    { metric: "OTIF", value: toNum(latestKpi.otifPercent) },
    { metric: "SLA", value: toNum(latestKpi.slaBreachRatePercent) !== null ? 100 - toNum(latestKpi.slaBreachRatePercent)! : null },
    { metric: "Tracking", value: toNum(latestKpi.trackingCompliancePercent) },
    { metric: "POD", value: toNum(latestKpi.podCompliancePercent) },
    { metric: "No Damage", value: toNum(latestKpi.damageShortageRatePercent) !== null ? 100 - toNum(latestKpi.damageShortageRatePercent)! : null },
    { metric: "No Exception", value: toNum(latestKpi.exceptionRatePercent) !== null ? 100 - toNum(latestKpi.exceptionRatePercent)! : null },
  ].filter((d): d is { metric: string; value: number } => d.value !== null) : [];

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate("/transporters")} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">{transporter.name}</h1>
          <p className="text-sm font-medium text-slate-500 mt-0.5">{transporter.city}, {transporter.state}</p>
        </div>
      </div>

      {/* Score + KPI pills */}
      {latestKpi && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className={cn("border-2 flex flex-col items-center justify-center py-8 shadow-sm", score !== null ? scoreBg(score) : "bg-slate-50 border-slate-200")}>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 opacity-80">Overall Score</p>
            {score !== null ? (
              <>
                <p className={cn("text-6xl font-extrabold tracking-tight", scoreColor(score))}>{score.toFixed(0)}</p>
                <p className="text-sm font-semibold text-slate-400 mt-1">/ 100</p>
              </>
            ) : (
              <p className="text-2xl font-bold text-slate-400">Unavailable</p>
            )}
            <p className="text-xs font-medium text-slate-500 mt-4 bg-white/50 px-3 py-1 rounded-full border border-black/5">
              {latestKpi.period} · {latestKpi.totalShipments} shipments
            </p>
          </Card>

          <Card className="lg:col-span-2">
            <CardBody className="p-6">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Performance Metrics</p>
              <div className="grid grid-cols-3 gap-4">
                <KPIPill label="OTIF" value={fmtPct(latestKpi.otifPercent)} good={(toNum(latestKpi.otifPercent) ?? 0) >= 90} neutral={toNum(latestKpi.otifPercent) === null} />
                <KPIPill label="Avg TAT" value={fmtHours(latestKpi.avgTatHours)} good={(toNum(latestKpi.avgTatHours) ?? 999) <= 24} neutral={toNum(latestKpi.avgTatHours) === null} />
                <KPIPill label="SLA Breach" value={fmtPct(latestKpi.slaBreachRatePercent)} good={(toNum(latestKpi.slaBreachRatePercent) ?? 100) <= 10} neutral={toNum(latestKpi.slaBreachRatePercent) === null} />
                <KPIPill label="Damage/Shortage" value={fmtPct(latestKpi.damageShortageRatePercent)} good={(toNum(latestKpi.damageShortageRatePercent) ?? 100) <= 2} neutral={toNum(latestKpi.damageShortageRatePercent) === null} />
                <KPIPill label="Tracking" value={fmtPct(latestKpi.trackingCompliancePercent)} good={(toNum(latestKpi.trackingCompliancePercent) ?? 0) >= 90} neutral={toNum(latestKpi.trackingCompliancePercent) === null} />
                <KPIPill label="POD Compliance" value={fmtPct(latestKpi.podCompliancePercent)} good={(toNum(latestKpi.podCompliancePercent) ?? 0) >= 90} neutral={toNum(latestKpi.podCompliancePercent) === null} />
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Score contribution breakdown */}
      {breakdown && (
        <Card>
          <CardHeader>
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-500" /> Score Contribution
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              How each KPI, weighted per the configured scoring policy, adds up to the overall score for {breakdown.compositeScore !== null ? "this period" : "this period (partial data)"}.
            </p>
          </CardHeader>
          <CardBody className="p-6 space-y-3">
            {breakdown.components.map((c) => (
              <div key={c.key} className="flex items-center gap-4">
                <div className="w-40 flex-shrink-0">
                  <p className="text-sm font-semibold text-slate-800">{c.label}</p>
                  <p className="text-[11px] text-slate-400">weight {(c.weight * 100).toFixed(0)}%</p>
                </div>
                <div className="flex-1">
                  {c.available ? (
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div
                        className={cn("h-2 rounded-full transition-all duration-500", (c.normalizedScore ?? 0) >= 80 ? "bg-emerald-500" : (c.normalizedScore ?? 0) >= 60 ? "bg-amber-500" : "bg-red-500")}
                        style={{ width: `${Math.min(100, c.normalizedScore ?? 0)}%` }}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 italic">{c.explanation}</p>
                  )}
                </div>
                <div className="w-40 flex-shrink-0 text-right">
                  {c.available ? (
                    <>
                      <span className="text-sm font-bold text-slate-800">+{c.weightedContribution.toFixed(1)} pts</span>
                      <p className="text-[11px] text-slate-400">{c.explanation}</p>
                    </>
                  ) : (
                    <Badge className="bg-slate-100 text-slate-500">Unavailable</Badge>
                  )}
                </div>
              </div>
            ))}
            <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between">
              <p className="text-sm font-bold text-slate-700">Overall Score</p>
              <p className={cn("text-lg font-extrabold", breakdown.compositeScore !== null ? scoreColor(breakdown.compositeScore) : "text-slate-400")}>
                {breakdown.compositeScore !== null ? breakdown.compositeScore.toFixed(1) : "Unavailable"}
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Radar chart */}
      {radarData.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-indigo-500" /> Performance Radar
            </h2>
          </CardHeader>
          <CardBody className="p-6">
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={radarData} outerRadius="75%">
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12, fill: "#64748b", fontWeight: 600 }} />
                <Radar name="Score" dataKey="value" stroke="#4f46e5" fill="#6366f1" fillOpacity={0.2} strokeWidth={2.5} />
                <Tooltip
                  formatter={(v) => [`${Number(v).toFixed(1)}%`, "Score"]}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      )}

      {/* KPI history table */}
      {kpis.length > 1 && (
        <Card>
          <CardHeader>
            <h2 className="font-bold text-slate-800">Historical Performance</h2>
            <p className="text-xs text-slate-500 mt-1">Trend across periods — each quarter's KPIs are computed independently from that quarter's shipments.</p>
          </CardHeader>
          <Table>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Shipments</Th>
                <Th>OTIF</Th>
                <Th>Avg TAT</Th>
                <Th>SLA Breach</Th>
                <Th>Tracking</Th>
                <Th>POD</Th>
                <Th>Score</Th>
              </tr>
            </thead>
            <tbody>
              {kpis.map((k) => {
                const kOtif = toNum(k.otifPercent);
                const kBreach = toNum(k.slaBreachRatePercent);
                const kScore = toNum(k.compositeScore);
                return (
                  <tr key={k.id} className="hover:bg-slate-50/80 transition-colors">
                    <Td className="font-bold text-slate-700">{k.period}</Td>
                    <Td className="font-medium text-slate-600">{k.totalShipments}</Td>
                    <Td className={cn("font-bold", kOtif !== null ? scoreColor(kOtif) : "text-slate-400")}>{fmtPct(k.otifPercent)}</Td>
                    <Td className="font-medium text-slate-600">{fmtHours(k.avgTatHours)}</Td>
                    <Td className={cn("font-medium", kBreach !== null && kBreach > 10 ? "text-red-600 font-bold" : "text-slate-600")}>{fmtPct(k.slaBreachRatePercent)}</Td>
                    <Td className="font-medium text-slate-600">{fmtPct(k.trackingCompliancePercent)}</Td>
                    <Td className="font-medium text-slate-600">{fmtPct(k.podCompliancePercent)}</Td>
                    <Td>
                      <span className={cn("font-extrabold", kScore !== null ? scoreColor(kScore) : "text-slate-400")}>{kScore !== null ? kScore.toFixed(0) : "—"}</span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
