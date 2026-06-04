import { z } from "zod";

export const dummySchema = z.object({
  message: z.string().default("Hello from shared!"),
});

export type DummyType = z.infer<typeof dummySchema>;

// Export shared types
export * from "./types/provider.types";
export * from "./types/node.types";

// Export node definitions & schemas
export * from "./definitions/index";
export * from "./definitions/registry";
export * from "./platform-limits";
export * from "./input-limits";
export * from "./media-list";
export * from "./workflow-graph";
export * from "./stub-demo-urls";
export * from "./node-estimates";
