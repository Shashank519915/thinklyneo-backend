import { describe, expect, it } from "vitest";
import {
  buildUnkeyRatelimits,
  isUnkeyManagedKey,
  toUnkeyExpires,
} from "@/lib/unkey-api-keys";

describe("unkey-api-keys helpers", () => {
  it("isUnkeyManagedKey returns false for mock keys", () => {
    expect(
      isUnkeyManagedKey({
        keyId: "abc123hash",
        maskedKey: "gx_mock_...abcd",
      })
    ).toBe(false);
  });

  it("isUnkeyManagedKey returns true for Unkey keys", () => {
    expect(
      isUnkeyManagedKey({
        keyId: "key_2jwySwwEYT8qB7HpEo6gFf",
        maskedKey: "gx_...U6S",
      })
    ).toBe(true);
  });

  it("buildUnkeyRatelimits uses per-minute and per-day windows", () => {
    const limits = buildUnkeyRatelimits(60, 1000);
    expect(limits).toHaveLength(2);
    expect(limits[0]).toMatchObject({
      name: "requests",
      limit: 60,
      duration: 60_000,
      autoApply: true,
    });
    expect(limits[1]).toMatchObject({
      name: "requests_daily",
      limit: 1000,
      duration: 86_400_000,
      autoApply: true,
    });
  });

  it("toUnkeyExpires converts Date to unix ms", () => {
    const d = new Date("2026-06-05T00:00:00.000Z");
    expect(toUnkeyExpires(d)).toBe(d.getTime());
  });

  it("toUnkeyExpires returns undefined for null/empty", () => {
    expect(toUnkeyExpires(null)).toBeUndefined();
    expect(toUnkeyExpires(undefined)).toBeUndefined();
  });
});
