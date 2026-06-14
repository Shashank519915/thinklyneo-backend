import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { buildUnkeyRatelimits } from "@/lib/unkey-api-keys";
import { encryptSecret, decryptSecret } from "./encryption";
import { logChat } from "./chat-log";

const SESSION_KEY_NAME = "Thinkly Brain Session";

async function mintUnkeyKey(userId: string): Promise<{ keyString: string; keyId: string; maskedKey: string }> {
  const rootKey = process.env.UNKEY_ROOT_KEY;
  const apiId = process.env.UNKEY_API_ID || process.env.UNKEY_API_KEY;
  const rateLimitPerMin = 120;
  const rateLimitPerDay = 5000;

  if (rootKey && apiId) {
    try {
      const { Unkey } = await import("@unkey/api");
      const unkey = new Unkey({ rootKey });
      const createResp = await unkey.keys.createKey({
        apiId,
        name: SESSION_KEY_NAME,
        prefix: "gx",
        externalId: userId,
        ratelimits: buildUnkeyRatelimits(rateLimitPerMin, rateLimitPerDay),
      });
      if (createResp.data) {
        const keyString = createResp.data.key;
        return {
          keyString,
          keyId: createResp.data.keyId,
          maskedKey: `gx_...${keyString.slice(-4)}`,
        };
      }
    } catch (err) {
      logChat("warn", "unkey_mint_failed", {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const mockToken = crypto.randomBytes(16).toString("hex");
  const keyString = `gx_mock_${mockToken}`;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Brain MCP session keys require UNKEY_ROOT_KEY and UNKEY_API_ID in production. Mock keys are disabled.",
    );
  }

  return {
    keyString,
    keyId: crypto.createHash("sha256").update(keyString).digest("hex"),
    maskedKey: `gx_mock_...${keyString.slice(-4)}`,
  };
}

/** Server-side MCP bearer for Brain chat — never exposed to the browser. */
export async function getOrMintUserApiKey(userId: string): Promise<string> {
  const existing = await prisma.chatSessionKey.findUnique({ where: { userId } });
  if (existing) {
    try {
      return decryptSecret(existing.encryptedKey);
    } catch {
      await prisma.chatSessionKey.delete({ where: { userId } });
    }
  }

  return await prisma.$transaction(async (tx) => {
    const again = await tx.chatSessionKey.findUnique({ where: { userId } });
    if (again) {
      try {
        return decryptSecret(again.encryptedKey);
      } catch {
        await tx.chatSessionKey.delete({ where: { userId } });
      }
    }

    const { keyString, keyId, maskedKey } = await mintUnkeyKey(userId);

    const apiKeyRecord = await tx.apiKey.create({
      data: {
        userId,
        name: SESSION_KEY_NAME,
        keyId,
        maskedKey,
        rateLimitPerMin: 120,
        rateLimitPerDay: 5000,
      },
    });

    await tx.chatSessionKey.create({
      data: {
        userId,
        apiKeyId: apiKeyRecord.id,
        encryptedKey: encryptSecret(keyString),
      },
    });

    return keyString;
  });
}

export function getMcpOrigin(): string {
  const backend = process.env.BACKEND_URL?.replace(/\/$/, "");
  const apiOrigin = process.env.THINKLY_API_ORIGIN?.replace(/\/$/, "");
  if (backend && apiOrigin && backend !== apiOrigin) {
    logChat("warn", "mcp_origin_mismatch", { backend, apiOrigin });
  }
  if (backend) return backend;
  if (apiOrigin) return apiOrigin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
