import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config";
import { errorHandler } from "./plugins/error-handler";
import { requirementsRoutes } from "./modules/requirements/routes";
import { facilitiesRoutes } from "./modules/facilities/routes";
import { transportersRoutes } from "./modules/transporters/routes";
import { vehiclesRoutes } from "./modules/vehicles/routes";
import { shipmentsRoutes } from "./modules/shipments/routes";
import { trackingRoutes } from "./modules/tracking/routes";
import { slaRoutes } from "./modules/sla/routes";
import { routeEventsRoutes } from "./modules/route-events/routes";
import { podRoutes } from "./modules/pod/routes";
import { quotationRoutes } from "./modules/quotation/routes";
import { kpiRoutes } from "./modules/kpi/routes";
import { dashboardRoutes } from "./modules/dashboard/routes";
import { usersRoutes } from "./modules/users/routes";
import { demoRoutes } from "./modules/demo/routes";
import { startSimulatorCron } from "./modules/tracking/simulator";

const app = Fastify({
  logger: {
    transport: config.isDev
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
    level: config.isDev ? "debug" : "info",
  },
});

async function bootstrap() {
  // Plugins
  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  // Set directly on the root instance, not via app.register(...) — a
  // plain plugin function gets its own encapsulation context, and a
  // setErrorHandler call inside it wouldn't reach sibling route plugins
  // registered below (see the doc-comment on errorHandler).
  app.setErrorHandler(errorHandler);

  // Health check
  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    env: config.nodeEnv,
  }));

  // All module routes under /api prefix
  const API_PREFIX = "/api";
  await app.register(async (api) => {
    await api.register(requirementsRoutes);
    await api.register(facilitiesRoutes);
    await api.register(transportersRoutes);
    await api.register(vehiclesRoutes);
    await api.register(shipmentsRoutes);
    await api.register(trackingRoutes);
    await api.register(slaRoutes);
    await api.register(routeEventsRoutes);
    await api.register(podRoutes);
    await api.register(quotationRoutes);
    await api.register(kpiRoutes);
    await api.register(dashboardRoutes);
    await api.register(usersRoutes);
    await api.register(demoRoutes);
  }, { prefix: API_PREFIX });

  // Start GPS simulation cron
  startSimulatorCron();

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`Server running on http://localhost:${config.port}`);
}

bootstrap().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
