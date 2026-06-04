import { z } from "zod";
import type { NodeProviderConfig } from "./provider.types";

export interface NodeParameter {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "slider" | "select" | "boolean" | "file-upload" | "image-array" | "video-array";
  required?: boolean;
  group: "primary" | "advanced";
  defaultValue?: any;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
  /** Placeholder text for text/textarea inputs. */
  placeholder?: string;
  /** Info icon tooltip on the field label (Magica-style). */
  tooltip?: string;
  /** `magica-side-label` = label left, control right (Merge A/V media rows).
   *  `crop-overlay-preview` = after this file-upload param, render a live crop overlay
   *  driven by sibling slider params x/y/w/h (Crop Image node). */
  uiVariant?: "magica-side-label" | "magica-volume-row" | "crop-overlay-preview";
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
