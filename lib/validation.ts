/**
 * @fileoverview Shared Zod contracts for workflows, runs, and import/export JSON bundles.
 * API routes coerce request bodies against these schemas before touching Prisma.
 */

import { z } from "zod";

/** `POST /api/workflows` validation — initial label + optional description. */
export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(5000).optional(),
});

/**
 * Partial patch payload backing `/api/workflows/[id]` (name/description/status plus raw graph blobs).
 *
 * IMPORTANT: `.superRefine` blocks empty graphs — prevents accidental truncation when autosave races.
 */
export const updateWorkflowSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(5000).nullable().optional(),
    nodes: z.array(z.any()).optional(),
    edges: z.array(z.any()).optional(),
    status: z.enum(["idle", "running", "done", "error"]).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.nodes === undefined) return;
    const nodes = data.nodes as unknown[];
    if (!Array.isArray(nodes)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "nodes must be an array",
        path: ["nodes"],
      });
      return;
    }
    if (nodes.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Refusing to persist an empty graph",
        path: ["nodes"],
      });
      return;
    }
    const types = new Set(
      nodes.map((n) =>
        typeof n === "object" && n !== null && "type" in n ? String((n as { type: unknown }).type) : "",
      ),
    );
    if (!types.has("requestInputs") || !types.has("response")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Graph must include requestInputs and response nodes",
        path: ["nodes"],
      });
    }
  });

/** `POST /run` body — distinguishes full vs selective execution planes. */
export const runWorkflowSchema = z.object({
  scope: z.enum(["full", "partial", "single"]),
  nodeIds: z.array(z.string()).optional(),
  inputValues: z.record(z.any()),
});

/** Max serialized workflow JSON accepted on `POST /api/workflows/import` (~15MB ceiling). */
export const importWorkflowSchema = z.object({
  json: z.string().min(1).max(15_000_000),
});

/**
 * Canonical disk/download JSON schema — also used client-side (`downloadJson`, import preview).
 *
 * Fields stay intentionally loose (`z.unknown` arrays) because React Flow node shapes evolve faster than enums.
 */
export const workflowFilePayloadSchema = z.object({
  version: z.string().max(32).optional(),
  name: z.string().min(1).max(120).optional(),
  exportedAt: z.string().max(64).optional(),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
});

export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
export type RunWorkflowInput = z.infer<typeof runWorkflowSchema>;
export type ImportWorkflowInput = z.infer<typeof importWorkflowSchema>;
