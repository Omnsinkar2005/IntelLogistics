import { FastifyInstance } from "fastify";
import {
  listTransporters,
  getTransporterById,
  getTransporterPerformance,
} from "./service";

export async function transportersRoutes(app: FastifyInstance) {
  app.get("/transporters", async (_request, reply) => {
    const transporters = await listTransporters();
    return reply.send({ success: true, data: transporters });
  });

  app.get("/transporters/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const transporter = await getTransporterById(id);
    return reply.send({ success: true, data: transporter });
  });

  app.get("/transporters/:id/performance", async (request, reply) => {
    const { id } = request.params as { id: string };
    const performance = await getTransporterPerformance(id);
    return reply.send({ success: true, data: performance });
  });
}
