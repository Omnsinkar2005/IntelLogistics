import { FastifyInstance } from "fastify";
import { getPublicQuotationInfo, submitQuotation, SubmitQuotationSchema } from "./service";

export async function quotationRoutes(app: FastifyInstance) {
  // ── Public, transporter-facing routes (reached via the one-time quotation link) ──
  // No auth — POC scope. The quote token itself is the only "credential".
  app.get("/public/quote/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const info = await getPublicQuotationInfo(token);
    return reply.send({ success: true, data: info });
  });

  app.post("/public/quote/:token/submit", async (request, reply) => {
    const { token } = request.params as { token: string };
    const body = SubmitQuotationSchema.parse(request.body);
    const offer = await submitQuotation(token, body);
    return reply.send({ success: true, data: offer });
  });
}
