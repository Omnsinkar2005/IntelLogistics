import { FastifyInstance } from "fastify";
import { listFacilities, getFacilityById } from "./service";
import { FacilityType } from "../../../generated/prisma/client";

export async function facilitiesRoutes(app: FastifyInstance) {
  app.get("/facilities", async (request, reply) => {
    const { type } = request.query as { type?: FacilityType };
    const facilities = await listFacilities(type);
    return reply.send({ success: true, data: facilities });
  });

  app.get("/facilities/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const facility = await getFacilityById(id);
    return reply.send({ success: true, data: facility });
  });
}
