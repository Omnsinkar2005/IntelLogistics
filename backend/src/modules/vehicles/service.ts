import { prisma } from "../../db/client";
import { NotFoundError } from "../../shared/errors";

export async function getVehiclesByTransporter(transporterId: string) {
  return prisma.vehicle.findMany({
    where: { transporterId, isActive: true },
    orderBy: { vehicleNumber: "asc" },
  });
}

export async function getVehicleById(id: string) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id },
    include: {
      transporter: { select: { id: true, name: true } },
      shipments: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, trackingNumber: true, status: true, createdAt: true },
      },
    },
  });
  if (!vehicle) throw new NotFoundError("Vehicle", id);
  return vehicle;
}
