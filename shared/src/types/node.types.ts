import { z } from "zod";

export interface NodeParameter {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "slider" | "select" | "file-upload" | "image-array";
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

export interface NodeDefinition {
  type: string;
  name: string;
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
  limits?: Record<string, { maxCount?: number; maxSizeMb?: number; maxLength?: number }>;
  inputSchema: z.ZodObject<any>;
  outputSchema: z.ZodObject<any>;
}
