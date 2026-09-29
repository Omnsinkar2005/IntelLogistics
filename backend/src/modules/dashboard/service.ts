import { prisma } from "../../db/client";
import { ShipmentStatus, PODStatus } from "../../../generated/prisma/client";

export async function getDashboardSummary() {
  const [
    totalShipments,
    activeShipments,
    atRiskShipments,
    delayedShipments,
    deliveredToday,
    pendingPODs,
    openRequirements,
    recentRiskEvents,
    latestKpiPerTransporter,
  ] = await Promise.all([
    prisma.shipment.count(),

    prisma.shipment.count({
      where: {
        status: {
          in: [
            ShipmentStatus.DISPATCHED,
            ShipmentStatus.IN_TRANSIT,
            ShipmentStatus.DELAYED,
            ShipmentStatus.AT_RISK,
          ],
        },
      },
    }),

    prisma.shipment.count({ where: { status: ShipmentStatus.AT_RISK } }),

    prisma.shipment.count({ where: { status: ShipmentStatus.DELAYED } }),

    prisma.shipment.count({
      where: {
        status: { in: [ShipmentStatus.DELIVERED, ShipmentStatus.COMPLETED] },
        deliveredAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
    }),

    prisma.pOD.count({ where: { status: PODStatus.SUBMITTED } }),

    prisma.transportRequirement.count({
      where: { status: { in: ["OPEN", "MATCHED"] } },
    }),

    prisma.sLARiskEvent.findMany({
      where: { isActive: true },
      orderBy: { triggeredAt: "desc" },
      take: 5,
      include: {
        shipment: {
          select: {
            id: true,
            trackingNumber: true,
            originCity: true,
            destinationCity: true,
            transporter: { select: { name: true } },
          },
        },
      },
    }),

    // One row per transporter — its most recently computed KPI snapshot —
    // not one row per (transporter, period). Ranking across all historical
    // periods would let the same transporter occupy multiple leaderboard
    // slots with stale scores.
    prisma.transporterKPI.findMany({
      orderBy: [{ transporterId: "asc" }, { computedAt: "desc" }],
      distinct: ["transporterId"],
      include: {
        transporter: { select: { id: true, name: true, city: true } },
      },
    }),
  ]);

  const topTransporters = latestKpiPerTransporter
    .filter((k) => k.compositeScore !== null)
    .sort((a, b) => Number(b.compositeScore) - Number(a.compositeScore))
    .slice(0, 5);

  return {
    shipments: {
      total: totalShipments,
      active: activeShipments,
      atRisk: atRiskShipments,
      delayed: delayedShipments,
      deliveredToday,
    },
    requirements: {
      open: openRequirements,
    },
    pod: {
      pendingReview: pendingPODs,
    },
    activeRisks: recentRiskEvents,
    topTransporters,
  };
}
