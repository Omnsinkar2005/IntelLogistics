import { FastifyInstance } from "fastify";
import { getDashboardSummary } from "./service";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/dashboard/summary", async (_request, reply) => {
    const summary = await getDashboardSummary();
    return reply.send({ success: true, data: summary });
  });
}
