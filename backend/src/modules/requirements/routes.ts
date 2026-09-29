import { FastifyInstance } from "fastify";
import {
  createRequirement,
  listRequirements,
  getRequirementById,
  updateRequirement,
  updateRequirementStatus,
  sendForQuotation,
  CreateRequirementSchema,
  UpdateRequirementSchema,
  SendForQuotationSchema,
} from "./service";
import { getMatchingTransporters } from "../matching/service";
import { RequirementStatus } from "../../../generated/prisma/client";

export async function requirementsRoutes(app: FastifyInstance) {
  app.post("/requirements", async (request, reply) => {
    const body = CreateRequirementSchema.parse(request.body);
    const requirement = await createRequirement(body);
    return reply.status(201).send({ success: true, data: requirement });
  });

  app.get("/requirements", async (request, reply) => {
    const { companyId } = request.query as { companyId?: string };
    const requirements = await listRequirements(companyId);
    return reply.send({ success: true, data: requirements });
  });

  app.get("/requirements/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const requirement = await getRequirementById(id);
    return reply.send({ success: true, data: requirement });
  });

  app.patch("/requirements/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = UpdateRequirementSchema.parse(request.body);
    const requirement = await updateRequirement(id, body);
    return reply.send({ success: true, data: requirement });
  });

  app.patch("/requirements/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: RequirementStatus };
    const updated = await updateRequirementStatus(id, status);
    return reply.send({ success: true, data: updated });
  });

  // Manager selects specific transporters + a quotation deadline and sends
  // the requirement for quotation — replaces the plain status-only send.
  app.post("/requirements/:id/send-for-quotation", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = SendForQuotationSchema.parse(request.body);
    const requirement = await sendForQuotation(id, body);
    return reply.send({ success: true, data: requirement });
  });

  // Transporter matching for a requirement
  app.get("/requirements/:id/transporters", async (request, reply) => {
    const { id } = request.params as { id: string };
    const matches = await getMatchingTransporters(id);
    return reply.send({ success: true, data: matches });
  });
}
