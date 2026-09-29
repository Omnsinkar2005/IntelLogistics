import { FastifyInstance } from "fastify";
import {
  startDemo, resetDemo, getDemoState, attachDemoShipment,
  startDemoMovement, pauseDemoMovement,
  triggerDemoTrafficDelay, triggerDemoRoadEvent, triggerDemoFestivalEvent,
  recalculateDemoETA, triggerDemoSLARisk, moveDemoToDestination,
  quickConfirmDemoDelivery, approveDemoPod,
  refreshDemoKpis,
} from "./service";

/**
 * Demo Mode control panel API — every handler here delegates to the real
 * business services (see service.ts). This module exists purely to give a
 * presenter a small, reliable set of one-click actions; it introduces no
 * new business rules of its own beyond the demo-lifecycle bookkeeping
 * (session tracking, reset, event-window refresh, destination teleport)
 * documented in service.ts.
 */
export async function demoRoutes(app: FastifyInstance) {
  app.post("/demo/start", async (_request, reply) => {
    const result = await startDemo();
    return reply.status(201).send({ success: true, data: result });
  });

  app.post("/demo/reset", async (_request, reply) => {
    const result = await resetDemo();
    return reply.send({ success: true, data: result });
  });

  app.get("/demo/state", async (_request, reply) => {
    const state = await getDemoState();
    return reply.send({ success: true, data: state });
  });

  // Called after the control panel creates the shipment via the real
  // POST /shipments endpoint, to record it as "the" demo shipment.
  app.post("/demo/attach-shipment", async (request, reply) => {
    const { shipmentId } = request.body as { shipmentId: string };
    const shipment = await attachDemoShipment(shipmentId);
    return reply.send({ success: true, data: shipment });
  });

  app.post("/demo/movement/start", async (_request, reply) => {
    const result = await startDemoMovement();
    return reply.send({ success: true, data: result });
  });

  app.post("/demo/movement/pause", async (_request, reply) => {
    const result = await pauseDemoMovement();
    return reply.send({ success: true, data: result });
  });

  app.post("/demo/trigger/traffic-delay", async (_request, reply) => {
    const result = await triggerDemoTrafficDelay();
    return reply.send({ success: true, data: result });
  });

  app.post("/demo/trigger/road-event", async (_request, reply) => {
    const result = await triggerDemoRoadEvent();
    return reply.send({ success: true, data: result });
  });

  app.post("/demo/trigger/festival-event", async (_request, reply) => {
    const result = await triggerDemoFestivalEvent();
    return reply.send({ success: true, data: result });
  });

  app.post("/demo/eta/recalculate", async (_request, reply) => {
    const result = await recalculateDemoETA();
    return reply.send({ success: true, data: result });
  });

  app.post("/demo/trigger/sla-risk", async (_request, reply) => {
    const result = await triggerDemoSLARisk();
    return reply.send({ success: true, data: result });
  });

  app.post("/demo/movement/complete", async (_request, reply) => {
    const result = await moveDemoToDestination();
    return reply.send({ success: true, data: result });
  });

  app.post("/demo/pod/quick-confirm", async (_request, reply) => {
    const result = await quickConfirmDemoDelivery();
    return reply.send({ success: true, data: result });
  });

  app.post("/demo/pod/approve", async (_request, reply) => {
    const result = await approveDemoPod();
    return reply.send({ success: true, data: result });
  });

  app.post("/demo/kpis/refresh", async (_request, reply) => {
    const result = await refreshDemoKpis();
    return reply.send({ success: true, data: result });
  });
}
