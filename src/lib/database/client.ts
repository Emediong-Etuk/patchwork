import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __patchworkPrisma?: PrismaClient };

export const db: PrismaClient =
  globalForPrisma.__patchworkPrisma ??
  new PrismaClient({ log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"] });

globalForPrisma.__patchworkPrisma = db;
