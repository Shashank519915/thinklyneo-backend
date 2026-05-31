import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { prisma } = await import("../lib/prisma");
  try {
    const workflowId = "cmpslc2ou000004ldae17jzv1";
    console.log("Fetching workflow:", workflowId);
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
    });

    if (!workflow) {
      console.error("Workflow not found!");
      return;
    }

    console.log("Workflow Name:", workflow.name);
    console.log("Nodes:");
    console.log(JSON.stringify(workflow.nodes, null, 2));
    console.log("Edges:");
    console.log(JSON.stringify(workflow.edges, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => console.error(e));
