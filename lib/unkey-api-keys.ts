/**
 * Unkey key lifecycle helpers — aligned with @unkey/api V2Keys* request bodies.
 * @see node_modules/@unkey/api/dist/esm/models/components/v2keys*.d.ts
 */

import type {
  RatelimitRequest,
  V2KeysUpdateKeyRequestBody,
} from "@unkey/api/models/components";

export type ApiKeyRecordLike = {
  keyId: string;
  maskedKey: string;
  name?: string;
  rateLimitPerMin?: number;
  rateLimitPerDay?: number;
  expiresAt?: Date | string | null;
};

/** Mock/fallback keys are local-only; never call Unkey with their hashed keyId. */
export function isUnkeyManagedKey(record: ApiKeyRecordLike): boolean {
  return (
    !record.maskedKey.startsWith("gx_mock_") &&
    !record.keyId.startsWith("gx_mock_")
  );
}

/** Unkey expects Unix ms; returns undefined when no expiry. */
export function toUnkeyExpires(
  expiresAt: Date | string | null | undefined
): number | undefined {
  if (!expiresAt) return undefined;
  const ms =
    expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

/** Per-minute + per-day windows (Unkey supports multiple named ratelimits). */
export function buildUnkeyRatelimits(
  perMin: number,
  perDay: number
): RatelimitRequest[] {
  return [
    {
      name: "requests",
      limit: perMin,
      duration: 60_000,
      autoApply: true,
    },
    {
      name: "requests_daily",
      limit: perDay,
      duration: 86_400_000,
      autoApply: true,
    },
  ];
}

export async function syncUnkeyKeyUpdate(
  record: ApiKeyRecordLike,
  patch: {
    name?: string;
    rateLimitPerMin?: number;
    rateLimitPerDay?: number;
    expiresAt?: Date | null;
  }
): Promise<void> {
  const rootKey = process.env.UNKEY_ROOT_KEY;
  if (!rootKey || !isUnkeyManagedKey(record)) return;

  const body: V2KeysUpdateKeyRequestBody = { keyId: record.keyId };
  let hasUpdates = false;

  if (patch.name !== undefined) {
    body.name = patch.name;
    hasUpdates = true;
  }

  if (patch.expiresAt !== undefined) {
    body.expires =
      patch.expiresAt === null ? null : toUnkeyExpires(patch.expiresAt);
    hasUpdates = true;
  }

  if (patch.rateLimitPerMin != null || patch.rateLimitPerDay != null) {
    const perMin = patch.rateLimitPerMin ?? record.rateLimitPerMin ?? 60;
    const perDay = patch.rateLimitPerDay ?? record.rateLimitPerDay ?? 1000;
    body.ratelimits = buildUnkeyRatelimits(perMin, perDay);
    hasUpdates = true;
  }

  if (!hasUpdates) return;

  try {
    const { Unkey } = await import("@unkey/api");
    const unkey = new Unkey({ rootKey });
    await unkey.keys.updateKey(body);
  } catch (err) {
    console.warn("[unkey-api-keys] updateKey failed:", err);
  }
}

export async function deleteUnkeyKey(keyId: string): Promise<void> {
  const rootKey = process.env.UNKEY_ROOT_KEY;
  if (!rootKey) return;

  const { Unkey } = await import("@unkey/api");
  const unkey = new Unkey({ rootKey });
  await unkey.keys.deleteKey({ keyId });
}
