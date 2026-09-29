import { FastifyInstance } from "fastify";
import {
  getPOD,
  reviewPOD,
  getPublicDeliveryInfo,
  confirmDelivery,
  ReviewPODSchema,
  ConfirmDeliverySchema,
} from "./service";

export async function podRoutes(app: FastifyInstance) {
  app.get("/shipments/:id/pod", async (request, reply) => {
    const { id } = request.params as { id: string };
    const pod = await getPOD(id);
    return reply.send({ success: true, data: pod });
  });

  // Manager approves or rejects a submitted POD
  app.patch("/shipments/:id/pod/review", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = ReviewPODSchema.parse(request.body);
    const pod = await reviewPOD(id, body);
    return reply.send({ success: true, data: pod });
  });

  // ── Public, receiver-facing routes (reached via the shipment's QR code) ──
  // No auth — POC scope. The QR token itself is the only "credential".
  app.get("/public/pod/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const info = await getPublicDeliveryInfo(token);
    return reply.send({ success: true, data: info });
  });

  app.post("/public/pod/:token/confirm", async (request, reply) => {
    const { token } = request.params as { token: string };
    const body = ConfirmDeliverySchema.parse(request.body);
    const pod = await confirmDelivery(token, body);
    return reply.send({ success: true, data: pod });
  });
}
