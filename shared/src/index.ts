import { z } from "zod";

export const dummySchema = z.object({
  message: z.string().default("Hello from shared!"),
});

export type DummyType = z.infer<typeof dummySchema>;

// Export shared types
export * from "./types/provider.types";
export * from "./types/node.types";

// Export node definitions & schemas
export * from "./definitions";
