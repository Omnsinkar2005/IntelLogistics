import { FastifyInstance } from "fastify";
import { computeKPIsForTransporter, getKPISummary, recalculateKPI } from "./service";

export async function kpiRoutes(app: FastifyInstance) {
  app.get("/kpi/summary", async (_request, reply) => {
    const summary = await getKPISummary();
    return reply.send({ success: true, data: summary });
  });

  // Read-only: computes the KPI breakdown (per-component score contribution)
  // for a transporter/period without writing anything. Defaults to the
  // current period.
  app.get("/kpi/:transporterId/breakdown", async (request, reply) => {
    const { transporterId } = request.params as { transporterId: string };
    const { period } = request.query as { period?: string };
    const breakdown = await computeKPIsForTransporter(transporterId, period);
    return reply.send({ success: true, data: breakdown });
  });

  app.post("/kpi/recalculate/:transporterId", async (request, reply) => {
    const { transporterId } = request.params as { transporterId: string };
    const { period } = (request.body as { period?: string } | undefined) ?? {};
    const kpi = await recalculateKPI(transporterId, period);
    return reply.send({ success: true, data: kpi });
  });
}
