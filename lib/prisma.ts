/**
 * @fileoverview Prisma client singleton wired to Neon’s serverless driver (WebSockets + Prisma adapter).
 * Hot reload dev environments reuse `globalForPrisma` to avoid exhausting DB connections.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";

// Required for Neon serverless
neonConfig.webSocketConstructor = WebSocket as unknown as typeof globalThis.WebSocket;

/**
 * Builds a Neon-aware PrismaClient; falls back to default client when DATABASE_URL omitted (CLI tooling).
 *
 * NOTE: Fallback path is unreachable in deployed app because route handlers require Neon env.
 */
function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return new PrismaClient();
  }
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/** Module-scoped singleton consumed by Route Handlers + Trigger hooks (never instantiate ad hoc per request manually). */
export const prisma =
  globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
