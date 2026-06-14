import { z } from "zod";

export const blueprintNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  label: z.string().min(1),
  params: z.record(z.unknown()).default({}),
});

export const blueprintEdgeSchema = z.object({
  source: z.string().min(1),
  sourceHandle: z.string().min(1),
  target: z.string().min(1),
  targetHandle: z.string().min(1),
});

export const blueprintFieldSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean().default(true),
});

export const blueprintSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  requestFields: z.array(blueprintFieldSchema).default([]),
  nodes: z.array(blueprintNodeSchema).default([]),
  edges: z.array(blueprintEdgeSchema).default([]),
  openQuestions: z.array(z.string()).default([]),
  confidence: z.enum(["draft", "review", "ready"]).default("draft"),
});

export type Blueprint = z.infer<typeof blueprintSchema>;

export const proposeBlueprintToolSchema = blueprintSchema;
