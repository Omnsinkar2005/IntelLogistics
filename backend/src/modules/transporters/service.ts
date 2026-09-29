import { prisma } from "../../db/client";
import { NotFoundError } from "../../shared/errors";

export async function listTransporters() {
  return prisma.transporter.findMany({
    where: { isActive: true },
    include: {
      _count: { select: { vehicles: true, shipments: true } },
      kpis: { orderBy: { computedAt: "desc" }, take: 1 },
    },
    orderBy: { name: "asc" },
  });
}

export async function getTransporterById(id: string) {
  const transporter = await prisma.transporter.findUnique({
    where: { id },
    include: {
      vehicles: { where: { isActive: true } },
      kpis: { orderBy: { computedAt: "desc" }, take: 4 },
      _count: { select: { shipments: true } },
    },
  });
  if (!transporter) throw new NotFoundError("Transporter", id);
  return transporter;
}

export async function getTransporterPerformance(id: string) {
  const transporter = await prisma.transporter.findUnique({ where: { id } });
  if (!transporter) throw new NotFoundError("Transporter", id);

  const kpis = await prisma.transporterKPI.findMany({
    where: { transporterId: id },
    orderBy: { computedAt: "desc" },
    take: 8,
  });

  const recentShipments = await prisma.shipment.findMany({
    where: { transporterId: id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      trackingNumber: true,
      status: true,
      originCity: true,
      destinationCity: true,
      slaDeadline: true,
      deliveredAt: true,
      agreedCostInr: true,
    },
  });

  return { transporter, kpis, recentShipments };
}

// Matching logic lives in src/modules/matching/
// Re-exported here for backward compatibility
export { getMatchingTransporters } from "../matching/service";
