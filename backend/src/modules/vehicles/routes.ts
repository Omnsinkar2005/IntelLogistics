import { FastifyInstance } from "fastify";
import { getVehiclesByTransporter, getVehicleById } from "./service";

export async function vehiclesRoutes(app: FastifyInstance) {
  app.get("/transporters/:transporterId/vehicles", async (request, reply) => {
    const { transporterId } = request.params as { transporterId: string };
    const vehicles = await getVehiclesByTransporter(transporterId);
    return reply.send({ success: true, data: vehicles });
  });

  app.get("/vehicles/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const vehicle = await getVehicleById(id);
    return reply.send({ success: true, data: vehicle });
  });
}
