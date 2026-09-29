import { prisma } from "../../db/client";

// No authentication in this POC (see PROJECT_CONTEXT.md — advanced auth is
// explicitly out of scope). These endpoints exist only so the UI can
// identify a real "current user" for actions that need to attribute to
// someone — POD review, and creating a transport requirement — instead of
// hardcoding a placeholder ID that doesn't exist in the database.

export async function listUsers() {
  return prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, role: true, companyId: true },
  });
}

/** First active manager, used as the default reviewer for POD approvals and requirement creator. */
export async function getDefaultManager() {
  return prisma.user.findFirst({
    where: { isActive: true, role: "MANAGER" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, role: true, companyId: true },
  });
}
