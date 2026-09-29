import { FastifyInstance } from "fastify";
import {
  createShipment,
  listShipments,
  getShipmentById,
  dispatchShipment,
  completeShipment,
  getShipmentTimeline,
  getPublicAssignmentInfo,
  CreateShipmentSchema,
} from "./service";
import { ShipmentStatus } from "../../../generated/prisma/client";

export async function shipmentsRoutes(app: FastifyInstance) {
  app.post("/shipments", async (request, reply) => {
    const body = CreateShipmentSchema.parse(request.body);
    const shipment = await createShipment(body);
    return reply.status(201).send({ success: true, data: shipment });
  });

  app.get("/shipments", async (request, reply) => {
    const { status } = request.query as { status?: ShipmentStatus };
    const shipments = await listShipments(status);
    return reply.send({ success: true, data: shipments });
  });

  app.get("/shipments/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const shipment = await getShipmentById(id);
    return reply.send({ success: true, data: shipment });
  });

  app.patch("/shipments/:id/dispatch", async (request, reply) => {
    const { id } = request.params as { id: string };
    const shipment = await dispatchShipment(id);
    return reply.send({ success: true, data: shipment });
  });

  app.patch("/shipments/:id/complete", async (request, reply) => {
    const { id } = request.params as { id: string };
    const shipment = await completeShipment(id);
    return reply.send({ success: true, data: shipment });
  });

  app.get("/shipments/:id/timeline", async (request, reply) => {
    const { id } = request.params as { id: string };
    const timeline = await getShipmentTimeline(id);
    return reply.send({ success: true, data: timeline });
  });

  // ── Public, transporter-facing route (simulated assignment notification) ──
  // No auth — POC scope. The assignment token itself is the only "credential".
  app.get("/public/shipment-assignment/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const info = await getPublicAssignmentInfo(token);
    return reply.send({ success: true, data: info });
  });
}
