import { z } from "zod";
import type { NodeProviderConfig } from "./provider.types";

export interface NodeParameter {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "slider" | "select" | "file-upload" | "image-array" | "video-array";
  required?: boolean;
  group: "primary" | "advanced";
  defaultValue?: any;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
  handle?: {
    type: "text" | "image" | "video" | "audio" | "file";
    color: string;
  };
}

export interface NodeOutputDefinition {
  key: string;
  label: string;
  type: "text" | "image" | "video" | "audio" | "file";
  handle: {
    type: "text" | "image" | "video" | "audio" | "file";
    color: string;
  };
}

export interface NodeInputLimit {
  maxCount?: number;
  maxSizeMb?: number;
  maxLength?: number;
  maxDurationSeconds?: number;
  maxWidth?: number;
  maxHeight?: number;
  mediaKind?: "image" | "video" | "audio" | "file";
}

export interface NodeDefinition {
  type: string;
  name: string;
  /** Shown in node header info tooltip */
  description?: string;
  category: "text" | "image" | "video" | "audio" | "utility";
  icon: string; // Lucide icon identifier
  color: string; // Tailwind/CSS theme color description or class name (e.g. orange, blue, purple)
  credits: {
    base: number; // Base microcredits cost
    perUnit?: number; // e.g. per second or per token cost
    unitName?: string;
  };
  inputs: NodeParameter[];
  outputs: NodeOutputDefinition[];
  limits?: Record<string, NodeInputLimit>;
  /** Ordered provider chain - first success wins; transparent to orchestrator */
  providers: NodeProviderConfig[];
  /** Default timeout (seconds) when a provider entry omits timeoutSeconds */
  defaultTimeoutSeconds?: number;
  /** Default retries per provider before advancing to the next in the chain */
  retryPerProvider?: number;
  inputSchema: z.ZodObject<any>;
  outputSchema: z.ZodObject<any>;
}
