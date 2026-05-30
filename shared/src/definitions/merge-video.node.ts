import { z } from "zod";
import { NodeDefinition } from "../types/node.types";

export const mergeVideoInputSchema = z.object({
  videoUrl1: z.string({ required_error: "First video is required" }).min(1, "First video is required"),
  videoUrl2: z.string({ required_error: "Second video is required" }).min(1, "Second video is required"),
  videoUrl3: z.string().nullable().optional(),
});

export const mergeVideoOutputSchema = z.object({
  outputVideo: z.string().url(),
});

export const mergeVideoDefinition: NodeDefinition = {
  type: "mergeVideo",
  name: "Merge Video",
  category: "video",
  icon: "Video",
  color: "teal",
  credits: {
    base: 300000, // 0.30M microcredits
  },
  inputs: [
    {
      key: "videoUrl1",
      label: "First Video Input",
      type: "file-upload",
      required: true,
      group: "primary",
      handle: {
        type: "video",
        color: "#3B82F6",
      },
    },
    {
      key: "videoUrl2",
      label: "Second Video Input",
      type: "file-upload",
      required: true,
      group: "primary",
      handle: {
        type: "video",
        color: "#3B82F6",
      },
    },
    {
      key: "videoUrl3",
      label: "Third Video Input (Optional)",
      type: "file-upload",
      group: "advanced",
      handle: {
        type: "video",
        color: "#3B82F6",
      },
    },
  ],
  outputs: [
    {
      key: "outputVideo",
      label: "Merged Video",
      type: "video",
      handle: {
        type: "video",
        color: "#3B82F6",
      },
    },
  ],
  inputSchema: mergeVideoInputSchema,
  outputSchema: mergeVideoOutputSchema,
};
