import { FastifyInstance } from "fastify";
import { getLatestLocation, getLocationHistory, getLatestETA } from "./service";
import { startSimulation, pauseSimulation, setSimulationMode, getSimulationState, SimulationMode } from "./simulator";

export async function trackingRoutes(app: FastifyInstance) {
  app.get("/shipments/:id/location", async (request, reply) => {
    const { id } = request.params as { id: string };
    const location = await getLatestLocation(id);
    return reply.send({ success: true, data: location });
  });

  app.get("/shipments/:id/locations", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { limit } = request.query as { limit?: string };
    const locations = await getLocationHistory(id, limit ? parseInt(limit) : 200);
    return reply.send({ success: true, data: locations });
  });

  app.get("/shipments/:id/eta", async (request, reply) => {
    const { id } = request.params as { id: string };
    const eta = await getLatestETA(id);
    return reply.send({ success: true, data: eta });
  });

  // --- Simulation Controls ---

  app.get("/shipments/:id/simulation", async (request, reply) => {
    const { id } = request.params as { id: string };
    const state = getSimulationState(id);
    return reply.send({ success: true, data: state });
  });

  app.post("/shipments/:id/simulation/start", async (request, reply) => {
    const { id } = request.params as { id: string };
    startSimulation(id);
    return reply.send({ success: true, data: getSimulationState(id) });
  });

  app.post("/shipments/:id/simulation/pause", async (request, reply) => {
    const { id } = request.params as { id: string };
    pauseSimulation(id);
    return reply.send({ success: true, data: getSimulationState(id) });
  });

  app.post("/shipments/:id/simulation/mode", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { mode } = request.body as { mode: SimulationMode };
    setSimulationMode(id, mode);
    return reply.send({ success: true, data: getSimulationState(id) });
  });
}
