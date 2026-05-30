import { z } from "zod";

export const dummySchema = z.object({
  message: z.string().default("Hello from shared!"),
});

export type DummyType = z.infer<typeof dummySchema>;
