import { prisma } from "../../db/client";
import { NotFoundError } from "../../shared/errors";
import { FacilityType } from "../../../generated/prisma/client";

export async function listFacilities(type?: FacilityType) {
  return prisma.facility.findMany({
    where: { isActive: true, ...(type ? { type } : {}) },
    orderBy: { name: "asc" },
  });
}

export async function getFacilityById(id: string) {
  const facility = await prisma.facility.findUnique({ where: { id } });
  if (!facility) throw new NotFoundError("Facility", id);
  return facility;
}
