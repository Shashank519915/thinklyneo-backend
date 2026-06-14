/**
 * @fileoverview Unit tests for chat persistence ownership guards.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindFirst,
  mockFindMany,
  mockMessageCreate,
  mockMessageFindFirst,
  mockMessageFindUnique,
  mockTransaction,
  mockMessageUpdate,
} = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockFindMany: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockMessageFindFirst: vi.fn(),
  mockMessageFindUnique: vi.fn(),
  mockMessageUpdate: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chat: { findFirst: mockFindFirst, update: vi.fn() },
    message: {
      findMany: mockFindMany,
      create: mockMessageCreate,
      findFirst: mockMessageFindFirst,
      findUnique: mockMessageFindUnique,
    },
    $transaction: mockTransaction,
  },
}));

import {
  persistUiMessages,
  verifyChatOwnership,
  persistRunCompletionMessage,
} from "@/lib/chat/persist";

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMany.mockResolvedValue([]);
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      message: {
        create: mockMessageCreate,
        findFirst: mockMessageFindFirst,
        update: mockMessageUpdate,
      },
    }),
  );
});

describe("verifyChatOwnership", () => {
  it("returns chat when user owns it", async () => {
    mockFindFirst.mockResolvedValue({ id: "c1", kind: "brain", workflowId: "wf_1" });
    const chat = await verifyChatOwnership("c1", "user_1", "brain");
    expect(chat?.id).toBe("c1");
  });

  it("returns null for wrong user", async () => {
    mockFindFirst.mockResolvedValue(null);
    const chat = await verifyChatOwnership("c1", "other", "brain");
    expect(chat).toBeNull();
  });
});

describe("persistUiMessages", () => {
  it("skips when chat not owned by user", async () => {
    mockFindFirst.mockResolvedValue(null);
    await persistUiMessages("c1", "user_1", [
      { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ]);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("inserts new messages for owned chat", async () => {
    mockFindFirst.mockResolvedValue({ id: "c1" });
    await persistUiMessages("c1", "user_1", [
      { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ]);
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockMessageCreate).toHaveBeenCalled();
  });
});

describe("persistRunCompletionMessage", () => {
  it("creates deduped completion message", async () => {
    mockFindFirst.mockResolvedValue({ id: "brain_1" });
    mockMessageFindUnique.mockResolvedValue(null);

    await persistRunCompletionMessage("brain_1", "user_1", {
      orchestratorRunId: "tr_abc123",
      summary: "Run completed.",
      sectionCount: 2,
      status: "success",
    });

    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "run-complete-tr_abc123",
          orchestratorRunId: "tr_abc123",
        }),
      }),
    );
  });
});
