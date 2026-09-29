import { FastifyInstance } from "fastify";
import { getAllActiveEvents, getEventsForShipment } from "./service";

export async function routeEventsRoutes(app: FastifyInstance) {
  app.get("/route-events", async (_request, reply) => {
    const events = await getAllActiveEvents();
    return reply.send({ success: true, data: events });
  });

  app.get("/shipments/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const events = await getEventsForShipment(id);
    return reply.send({ success: true, data: events });
  });
}
