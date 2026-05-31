import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

// Resolve paths for loading local env vars in development BEFORE prisma load
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config();

// 1 credit = 1,000,000 microcredits
const BASE_ESTIMATES: Record<string, number> = {
  cropImage: 0,
  gemini: 1000000, // 1.0M
  gptImage2: 1000000, // 1.0M
  klingV3: 2000000, // 2.0M
  mergeVideo: 0,
  mergeAV: 0,
  extractAudio: 0,
};

function estimateWorkflowCost(nodes: any[]): number {
  let total = 0;
  for (const node of nodes) {
    total += BASE_ESTIMATES[node.type] || 0;
  }
  return total;
}

// Default system nodes for new workflow creation
const DEFAULT_NODES = [
  {
    id: "request-inputs",
    type: "requestInputs",
    position: { x: 100, y: 250 },
    data: {
      label: "Request-Inputs",
      fields: [
        {
          id: "field_text_default",
          type: "text_field",
          label: "text_field",
          value: "",
        },
      ],
    },
  },
  {
    id: "response",
    type: "response",
    position: { x: 700, y: 250 },
    data: {
      label: "Output",
      results: [],
    },
  },
];

const DEFAULT_EDGES: any[] = [];

async function main() {
  // Dynamic imports inside async function to avoid CJS top-level await error
  const { prisma } = await import("../lib/prisma.js");
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
  } = await import("@modelcontextprotocol/sdk/types.js");
  const { Prisma } = await import("@prisma/client");

  async function getOrCreateBalance(userId: string): Promise<number> {
    const existing = await prisma.creditBalance.findUnique({
      where: { userId },
    });

    if (existing) {
      return existing.balance;
    }

    // Create default initial grant transactionally
    const INITIAL_GRANT_MICROCREDITS = 100000000; // 100.00 credits
    const result = await prisma.$transaction(async (tx) => {
      const innerExisting = await tx.creditBalance.findUnique({
        where: { userId },
      });
      if (innerExisting) return innerExisting;

      const newBalance = await tx.creditBalance.create({
        data: {
          userId,
          balance: INITIAL_GRANT_MICROCREDITS,
        },
      });

      await tx.creditLedger.create({
        data: {
          userId,
          amount: INITIAL_GRANT_MICROCREDITS,
          type: "initial_grant",
          description: "Initial signup credits grant",
          balanceAfter: INITIAL_GRANT_MICROCREDITS,
        },
      });

      return newBalance;
    });

    return result.balance;
  }

  /**
   * Validates the API key from environment variables.
   * Resolves to the Clerk owner userId or throws an error.
   */
  async function authenticateUser(): Promise<string> {
    const token = process.env.GALAXY_API_KEY;
    if (!token) {
      throw new Error(
        "GALAXY_API_KEY environment variable is not configured. Set GALAXY_API_KEY to authenticate with the platform."
      );
    }

    const cleanToken = token.trim();
    const rootKey = process.env.UNKEY_ROOT_KEY;
    const apiId = process.env.UNKEY_API_ID;
    const isUnkeyConfigured = !!(rootKey && apiId);

    if (isUnkeyConfigured && !cleanToken.startsWith("gx_mock_")) {
      try {
        const verifyResp = await fetch("https://api.unkey.dev/v1/keys.verifyKey", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: cleanToken, apiId }),
        });

        if (verifyResp.ok) {
          const result = await verifyResp.json();
          if (result.valid && result.ownerId) {
            return result.ownerId;
          }
        }
      } catch (unkeyErr) {
        console.error("[MCP Auth] Unkey verify failed, falling back to local DB check", unkeyErr);
      }
    }

    // Fallback / Mock Mode: Check local database for hashed API key match
    const hashed = crypto.createHash("sha256").update(cleanToken).digest("hex");
    const keyRecord = await prisma.apiKey.findUnique({
      where: { keyId: hashed },
      select: { userId: true },
    });

    if (!keyRecord) {
      throw new Error("Invalid GALAXY_API_KEY configured for the MCP server.");
    }

    return keyRecord.userId;
  }

  // Create MCP Server
  const server = new Server(
    {
      name: "galaxy-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register Tool Schemas
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "list_workflows",
          description: "Lists all workflow canvases owned by the user (metadata only).",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "get_workflow",
          description: "Fetch nodes, edges, and details of a single workflow.",
          inputSchema: {
            type: "object",
            properties: {
              workflowId: {
                type: "string",
                description: "The unique ID of the workflow to fetch.",
              },
            },
            required: ["workflowId"],
          },
        },
        {
          name: "create_workflow",
          description: "Create a new workflow canvas with default Request-Inputs and Response nodes.",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "The display name of the new workflow.",
              },
              description: {
                type: "string",
                description: "Optional description of what this workflow does.",
              },
            },
            required: ["name"],
          },
        },
        {
          name: "start_run",
          description: "Executes a workflow by topological node ordering. Deducts credits and runs in background.",
          inputSchema: {
            type: "object",
            properties: {
              workflowId: {
                type: "string",
                description: "The unique ID of the workflow to execute.",
              },
              inputValues: {
                type: "object",
                description: "Optional override key-value parameters passed to Request-Inputs node.",
              },
            },
            required: ["workflowId"],
          },
        },
        {
          name: "get_run_status",
          description: "Poll status, durations, errors, and terminal output results of a workflow execution run.",
          inputSchema: {
            type: "object",
            properties: {
              runId: {
                type: "string",
                description: "The unique ID of the execution run.",
              },
            },
            required: ["runId"],
          },
        },
        {
          name: "get_balance",
          description: "Check the current remaining microcredits balance of the user.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
      ],
    };
  });

  // Handle Tool Calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const userId = await authenticateUser();

      switch (name) {
        case "list_workflows": {
          const workflows = await prisma.workflow.findMany({
            where: { userId },
            orderBy: { updatedAt: "desc" },
            select: {
              id: true,
              name: true,
              description: true,
              status: true,
              createdAt: true,
              updatedAt: true,
            },
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(workflows, null, 2),
              },
            ],
          };
        }

        case "get_workflow": {
          const { workflowId } = args as { workflowId: string };
          const workflow = await prisma.workflow.findUnique({
            where: { id: workflowId, userId },
          });

          if (!workflow) {
            throw new McpError(ErrorCode.InvalidParams, `Workflow with ID '${workflowId}' not found.`);
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(workflow, null, 2),
              },
            ],
          };
        }

        case "create_workflow": {
          const { name: wfName, description } = args as { name: string; description?: string };
          const newWorkflow = await prisma.workflow.create({
            data: {
              userId,
              name: wfName,
              description: description ?? null,
              nodes: DEFAULT_NODES as any,
              edges: DEFAULT_EDGES as any,
              status: "idle",
            },
          });

          return {
            content: [
              {
                type: "text",
                text: `Workflow created successfully:\n${JSON.stringify(newWorkflow, null, 2)}`,
              },
            ],
          };
        }

        case "start_run": {
          const { workflowId, inputValues = {} } = args as { workflowId: string; inputValues?: Record<string, any> };

          const workflow = await prisma.workflow.findUnique({
            where: { id: workflowId, userId },
          });

          if (!workflow) {
            throw new McpError(ErrorCode.InvalidParams, `Workflow with ID '${workflowId}' not found.`);
          }

          // Prevent concurrent runs
          const existingRun = await prisma.workflowRun.findFirst({
            where: { workflowId, status: "running" },
          });

          if (existingRun) {
            throw new McpError(
              ErrorCode.InternalError,
              `A run is already in progress for this workflow (Run ID: ${existingRun.id})`
            );
          }

          const allNodes = (workflow.nodes as any[]) ?? [];
          const estimatedCost = estimateWorkflowCost(allNodes);

          // Run transaction to check credits hold
          const run = await prisma.$transaction(async (tx) => {
            const balance = await getOrCreateBalance(userId);
            if (balance < estimatedCost) {
              throw new Error(
                `Insufficient credits. Estimated cost: ${(estimatedCost / 1000000).toFixed(2)}M, but balance is ${(balance / 1000000).toFixed(2)}M.`
              );
            }

            const newRun = await tx.workflowRun.create({
              data: {
                workflowId,
                userId,
                scope: "full",
                status: "running",
                startedAt: new Date(),
                inputValues: (inputValues ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              },
            });

            if (estimatedCost > 0) {
              const nextBalance = balance - estimatedCost;
              await tx.creditBalance.update({
                where: { userId },
                data: { balance: nextBalance },
              });

              await tx.creditLedger.create({
                data: {
                  userId,
                  amount: -estimatedCost,
                  type: "hold",
                  description: `Hold for MCP workflow run ${newRun.id}`,
                  runId: newRun.id,
                  balanceAfter: nextBalance,
                },
              });
            }

            await tx.workflow.update({
              where: { id: workflowId },
              data: { status: "running" },
            });

            return newRun;
          });

          // Trigger orchestrator task on Trigger.dev
          const { tasks } = await import("@trigger.dev/sdk/v3");
          const orchestratorRun = await tasks.trigger("workflow-orchestrator", {
            workflowId,
            runId: run.id,
            nodes: (workflow.nodes as any[]),
            edges: (workflow.edges as any[]),
            inputValues,
            scope: "full",
          });

          // Store orchestrator run ID in DB record
          await prisma.workflowRun.update({
            where: { id: run.id },
            data: { orchestratorRunId: orchestratorRun.id },
          });

          // Fire webhook notification for run start
          try {
            const { triggerOutboundWebhook } = await import("../lib/webhooks.js");
            await triggerOutboundWebhook(run.id, "run.started", true, {
              scope: "full",
              inputValues,
            });
          } catch (webhookErr) {
            console.error("[MCP Run] Failed to dispatch start webhook", webhookErr);
          }

          return {
            content: [
              {
                type: "text",
                text: `Workflow execution started successfully:\n${JSON.stringify(
                  {
                    runId: run.id,
                    status: "running",
                    orchestratorRunId: orchestratorRun.id,
                    estimatedCost: `${(estimatedCost / 1000000).toFixed(2)}M credits`,
                  },
                  null,
                  2
                )}`,
              },
            ],
          };
        }

        case "get_run_status": {
          const { runId } = args as { runId: string };

          const run = await prisma.workflowRun.findFirst({
            where: { id: runId, userId },
            include: {
              nodeRuns: {
                select: {
                  id: true,
                  nodeId: true,
                  nodeName: true,
                  status: true,
                  startedAt: true,
                  finishedAt: true,
                  durationMs: true,
                  inputs: true,
                  output: true,
                  error: true,
                  providerUsed: true,
                  creditCost: true,
                },
              },
            },
          });

          if (!run) {
            throw new McpError(ErrorCode.InvalidParams, `Workflow run with ID '${runId}' not found.`);
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(run, null, 2),
              },
            ],
          };
        }

        case "get_balance": {
          const balance = await getOrCreateBalance(userId);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    microcredits: balance,
                    creditsAmount: (balance / 1000000).toFixed(2) + "M credits",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool name: ${name}`);
      }
    } catch (error: any) {
      console.error(`MCP Tool execution error for ${name}:`, error);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Galaxy MCP Server started successfully on StdIO.");
}

main().catch((err) => {
  console.error("MCP Server main loop crashed:", err);
  process.exit(1);
});
