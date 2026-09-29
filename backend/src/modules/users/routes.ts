import { FastifyInstance } from "fastify";
import { getDefaultManager, listUsers } from "./service";

export async function usersRoutes(app: FastifyInstance) {
  app.get("/users", async (_request, reply) => {
    const users = await listUsers();
    return reply.send({ success: true, data: users });
  });

  app.get("/users/default-manager", async (_request, reply) => {
    const manager = await getDefaultManager();
    return reply.send({ success: true, data: manager });
  });
}
