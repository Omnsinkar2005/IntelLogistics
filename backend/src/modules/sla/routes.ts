import { FastifyInstance } from "fastify";
import { getShipmentSLA, getShipmentSLARisk } from "./service";

export async function slaRoutes(app: FastifyInstance) {
  app.get("/shipments/:id/sla", async (request, reply) => {
    const { id } = request.params as { id: string };
    const sla = await getShipmentSLA(id);
    return reply.send({ success: true, data: sla });
  });

  app.get("/shipments/:id/sla-risk", async (request, reply) => {
    const { id } = request.params as { id: string };
    const risk = await getShipmentSLARisk(id);
    return reply.send({ success: true, data: risk });
  });
}
