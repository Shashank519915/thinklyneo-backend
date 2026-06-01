/**
 * Smoke test for MCP auth + DB tools (no StdIO JSON-RPC).
 * Usage: GALAXY_API_KEY=gx_... pnpm exec tsx scripts/test-mcp-smoke.ts
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config();

async function main() {
  const token = process.env.GALAXY_API_KEY?.trim();
  if (!token) {
    console.error("FAIL: Set GALAXY_API_KEY in the environment.");
    process.exit(1);
  }

  const { prisma } = await import("../lib/prisma.js");
  const { getOrCreateBalance, estimateWorkflowCost } = await import("../lib/credits.js");

  // --- auth (same logic as mcp-server.ts) ---
  let userId: string | null = null;
  const rootKey = process.env.UNKEY_ROOT_KEY;
  const apiId = process.env.UNKEY_API_ID || process.env.UNKEY_API_KEY;
  const isUnkeyConfigured = !!(rootKey && apiId);

  if (isUnkeyConfigured && !token.startsWith("gx_mock_")) {
    try {
      const verifyResp = await fetch("https://api.unkey.com/v2/keys.verifyKey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${rootKey}`,
        },
        body: JSON.stringify({ key: token }),
      });
      if (verifyResp.ok) {
        const result = await verifyResp.json();
        const data = result.data || {};
        userId = data.identity?.externalId || data.ownerId;
        if (data.valid && userId) {
          console.log("OK: Unkey verified key → userId", userId);
        }
      }
    } catch (e) {
      console.warn("Unkey verify failed, trying local DB:", e);
    }
  }

  if (!userId) {
    const hashed = crypto.createHash("sha256").update(token).digest("hex");
    const keyRecord = await prisma.apiKey.findUnique({
      where: { keyId: hashed },
      select: { userId: true },
    });
    if (!keyRecord) {
      console.error("FAIL: Key not found in Unkey or local ApiKey table.");
      process.exit(1);
    }
    userId = keyRecord.userId;
    console.log("OK: Local DB key → userId", userId);
  }

  const balance = await getOrCreateBalance(userId);
  console.log("OK: balance (microcredits)", balance, `(${(balance / 1_000_000).toFixed(2)}M)`);

  const workflows = await prisma.workflow.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { id: true, name: true, status: true },
  });
  console.log("OK: workflows (up to 5):", workflows.length ? workflows : "(none)");

  if (workflows[0]) {
    const nodes = (await prisma.workflow.findUnique({
      where: { id: workflows[0].id },
      select: { nodes: true },
    }))?.nodes as { type: string }[] | null;
    const est = estimateWorkflowCost(nodes ?? []);
    console.log(`OK: estimate for "${workflows[0].name}":`, est, "microcredits");
  }

  console.log("\nMCP smoke test passed. StdIO server should work with the same GALAXY_API_KEY.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
