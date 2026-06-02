import { describe, it, expect } from "vitest";
import {
  createWorkflowSchema,
  updateWorkflowSchema,
  runWorkflowSchema,
  workflowFilePayloadSchema,
} from "@/lib/validation";

// ─── createWorkflowSchema ───────────────────────────────────────────────────

describe("createWorkflowSchema", () => {
  it("accepts a valid name", () => {
    expect(createWorkflowSchema.safeParse({ name: "My pipeline" }).success).toBe(true);
  });

  it("accepts name with optional description", () => {
    expect(
      createWorkflowSchema.safeParse({ name: "Pipeline", description: "Does image processing" })
        .success
    ).toBe(true);
  });

  it("rejects empty name", () => {
    expect(createWorkflowSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects name longer than 120 characters", () => {
    expect(createWorkflowSchema.safeParse({ name: "a".repeat(121) }).success).toBe(false);
  });

  it("accepts name exactly 120 characters", () => {
    expect(createWorkflowSchema.safeParse({ name: "a".repeat(120) }).success).toBe(true);
  });

  it("rejects description longer than 5000 characters", () => {
    expect(
      createWorkflowSchema.safeParse({ name: "Valid", description: "x".repeat(5001) }).success
    ).toBe(false);
  });

  it("accepts description exactly 5000 characters", () => {
    expect(
      createWorkflowSchema.safeParse({ name: "Valid", description: "x".repeat(5000) }).success
    ).toBe(true);
  });

  it("rejects missing name field", () => {
    expect(createWorkflowSchema.safeParse({}).success).toBe(false);
  });
});

// ─── updateWorkflowSchema ───────────────────────────────────────────────────

describe("updateWorkflowSchema", () => {
  it("accepts an empty payload (all optional)", () => {
    expect(updateWorkflowSchema.safeParse({}).success).toBe(true);
  });

  it("accepts name-only update", () => {
    expect(updateWorkflowSchema.safeParse({ name: "Renamed" }).success).toBe(true);
  });

  it("rejects an empty nodes array", () => {
    const result = updateWorkflowSchema.safeParse({ nodes: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("empty graph"))).toBe(true);
    }
  });

  it("rejects nodes missing requestInputs type", () => {
    const result = updateWorkflowSchema.safeParse({
      nodes: [{ type: "gptImage2" }, { type: "response" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("requestInputs"))).toBe(true);
    }
  });

  it("rejects nodes missing response type", () => {
    const result = updateWorkflowSchema.safeParse({
      nodes: [{ type: "requestInputs" }, { type: "gptImage2" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid minimal graph with required scaffold types", () => {
    const result = updateWorkflowSchema.safeParse({
      nodes: [{ type: "requestInputs" }, { type: "response" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a graph with scaffold types plus processing nodes", () => {
    const result = updateWorkflowSchema.safeParse({
      nodes: [{ type: "requestInputs" }, { type: "gptImage2" }, { type: "response" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts all valid status values", () => {
    for (const status of ["idle", "running", "done", "error"]) {
      expect(updateWorkflowSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it("rejects invalid status value", () => {
    expect(updateWorkflowSchema.safeParse({ status: "pending" }).success).toBe(false);
  });

  it("accepts null description (clears it)", () => {
    expect(updateWorkflowSchema.safeParse({ description: null }).success).toBe(true);
  });

  it("rejects name longer than 120 characters on update", () => {
    expect(updateWorkflowSchema.safeParse({ name: "a".repeat(121) }).success).toBe(false);
  });
});

// ─── runWorkflowSchema ──────────────────────────────────────────────────────

describe("runWorkflowSchema", () => {
  it("accepts full scope with inputValues", () => {
    expect(
      runWorkflowSchema.safeParse({
        scope: "full",
        inputValues: { field_text_default: "A prompt" },
      }).success
    ).toBe(true);
  });

  it("accepts partial scope with nodeIds", () => {
    expect(
      runWorkflowSchema.safeParse({
        scope: "partial",
        nodeIds: ["node-1"],
        inputValues: {},
      }).success
    ).toBe(true);
  });

  it("accepts single scope", () => {
    expect(
      runWorkflowSchema.safeParse({
        scope: "single",
        nodeIds: ["node-1"],
        inputValues: {},
      }).success
    ).toBe(true);
  });

  it("rejects invalid scope value", () => {
    expect(
      runWorkflowSchema.safeParse({ scope: "all", inputValues: {} }).success
    ).toBe(false);
  });

  it("rejects missing inputValues", () => {
    expect(runWorkflowSchema.safeParse({ scope: "full" }).success).toBe(false);
  });

  it("accepts empty inputValues object", () => {
    expect(
      runWorkflowSchema.safeParse({ scope: "full", inputValues: {} }).success
    ).toBe(true);
  });

  it("accepts inputValues with mixed value types", () => {
    expect(
      runWorkflowSchema.safeParse({
        scope: "full",
        inputValues: {
          field_text: "hello",
          field_num: 42,
          field_bool: true,
          field_image: ["https://example.com/img.png"],
        },
      }).success
    ).toBe(true);
  });
});

// ─── workflowFilePayloadSchema ──────────────────────────────────────────────

describe("workflowFilePayloadSchema", () => {
  it("accepts a complete valid bundle", () => {
    expect(
      workflowFilePayloadSchema.safeParse({
        version: "1.0",
        name: "My workflow",
        exportedAt: "2026-06-02T00:00:00.000Z",
        nodes: [{ id: "a", type: "requestInputs" }],
        edges: [],
      }).success
    ).toBe(true);
  });

  it("accepts bundle with only required fields", () => {
    expect(workflowFilePayloadSchema.safeParse({ nodes: [], edges: [] }).success).toBe(true);
  });

  it("rejects bundle missing nodes", () => {
    expect(workflowFilePayloadSchema.safeParse({ edges: [] }).success).toBe(false);
  });

  it("rejects bundle missing edges", () => {
    expect(workflowFilePayloadSchema.safeParse({ nodes: [] }).success).toBe(false);
  });

  it("rejects completely empty object", () => {
    expect(workflowFilePayloadSchema.safeParse({}).success).toBe(false);
  });
});
