import { z } from "zod";
import { NodeDefinition } from "../types/node.types";

export const cropImageInputSchema = z.object({
  inputImage: z.string({ required_error: "Input Image is required" }).min(1, "Input Image is required"),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  w: z.number().min(1).max(100),
  h: z.number().min(1).max(100),
});

export const cropImageOutputSchema = z.object({
  outputImage: z.string().url(),
});

export const cropImageDefinition: NodeDefinition = {
  type: "cropImage",
  name: "Crop Image",
  category: "image",
  icon: "Crop",
  color: "orange",
  credits: {
    base: 210000, // 0.21M microcredits
  },
  inputs: [
    {
      key: "inputImage",
      label: "Input Image",
      type: "file-upload",
      required: true,
      group: "primary",
      handle: {
        type: "image",
        color: "#3b82f6",
      },
    },
    {
      key: "x",
      label: "X Position (%)",
      type: "slider",
      defaultValue: 0,
      min: 0,
      max: 100,
      step: 1,
      group: "primary",
      handle: {
        type: "text",
        color: "#ec4899",
      },
    },
    {
      key: "y",
      label: "Y Position (%)",
      type: "slider",
      defaultValue: 0,
      min: 0,
      max: 100,
      step: 1,
      group: "primary",
      handle: {
        type: "text",
        color: "#ec4899",
      },
    },
    {
      key: "w",
      label: "Width (%)",
      type: "slider",
      defaultValue: 100,
      min: 1,
      max: 100,
      step: 1,
      group: "primary",
      handle: {
        type: "text",
        color: "#ec4899",
      },
    },
    {
      key: "h",
      label: "Height (%)",
      type: "slider",
      defaultValue: 100,
      min: 1,
      max: 100,
      step: 1,
      group: "primary",
      handle: {
        type: "text",
        color: "#ec4899",
      },
    },
  ],
  outputs: [
    {
      key: "outputImage",
      label: "Output Image",
      type: "image",
      handle: {
        type: "image",
        color: "#3b82f6",
      },
    },
  ],
  limits: {
    inputImage: { mediaKind: "image", maxSizeMb: 15, maxWidth: 4096, maxHeight: 4096 },
  },
  inputSchema: cropImageInputSchema,
  outputSchema: cropImageOutputSchema,
  retryPerProvider: 1,
  providers: [
    {
      id: "main-ffmpeg",
      kind: "ffmpeg",
    },
    {
      id: "backup-stub",
      kind: "stub",
      stubDelaySeconds: 2,
      stubUrl: "https://images.transloadit.com/examples/landscape.jpg",
    },
  ],
};
