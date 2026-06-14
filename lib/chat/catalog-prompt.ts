import { listNodeTypes } from "@/lib/mcp/node-catalog";

/** Compact node catalog for Helper / Thinkly system prompts (deterministic, always current). */
export function buildNodeCatalogPrompt(): string {
  const catalog = listNodeTypes();
  return JSON.stringify(catalog, null, 2);
}
