import { tool } from "ai";
import { z } from "zod";

/** Client-executed UI tools (no server execute) — handled in useChat onToolCall. */
export const brainUiTools = {
  offer_edit_handoff: tool({
    description:
      "Show the user an Edit in canvas affordance for the bound workflow. Call after create_workflow or when manual graph edits are needed.",
    inputSchema: z.object({
      workflowId: z.string().min(1),
      label: z.string().optional(),
    }),
  }),
  pin_live_run: tool({
    description:
      "Pin a live run panel in chat after start_run returns orchestratorRunId. Call immediately after a successful start_run.",
    inputSchema: z.object({
      orchestratorRunId: z.string().min(1),
      workflowId: z.string().min(1),
    }),
  }),
};
