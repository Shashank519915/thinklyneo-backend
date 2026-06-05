/**
 * Canonical workflow graph templates for API and MCP creation.
 */

export const WORKFLOW_TEMPLATES = ["empty", "advertisement"] as const;
export type WorkflowTemplate = (typeof WORKFLOW_TEMPLATES)[number];

export const DEFAULT_EMPTY_NODES = [
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

export const DEFAULT_EMPTY_EDGES: unknown[] = [];

const DEFAULT_PRODUCT_BRIEF =
  "Product: Custom graphic t-shirts. Promotion: Seasonal sale with limited-edition designs and free shipping.";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Marketing pipeline: crop product images → copy → hook → final social post. */
export function buildAdvertisementGraph(productBrief?: string) {
  const brief = productBrief?.trim() || DEFAULT_PRODUCT_BRIEF;

  const nodes = [
    {
      id: "request-inputs",
      type: "requestInputs",
      position: { x: 50, y: 200 },
      data: {
        label: "Request-Inputs",
        fields: [
          {
            id: "field_text_1",
            type: "text_field",
            label: "text_field",
            value: brief,
          },
          {
            id: "field_image_1",
            type: "image_field",
            label: "image_field",
            value: null,
          },
        ],
      },
    },
    {
      id: "crop-1",
      type: "cropImage",
      position: { x: 480, y: 80 },
      data: {
        label: "Crop Image #1",
        inputs: { inputImage: null, x: 20, y: 20, w: 60, h: 60 },
        output: null,
      },
    },
    {
      id: "crop-2",
      type: "cropImage",
      position: { x: 480, y: 340 },
      data: {
        label: "Crop Image #2",
        inputs: { inputImage: null, x: 0, y: 0, w: 100, h: 50 },
        output: null,
      },
    },
    {
      id: "gemini-1",
      type: "openRouter",
      position: { x: 480, y: 600 },
      data: {
        label: "OpenRouter LLM #1",
        inputs: {
          prompt: null,
          systemPrompt:
            "You are a marketing copywriter. Write a one-paragraph product description based on the product and promotion details provided.",
          images: [],
          video: null,
          audio: null,
          file: null,
          temperature: 1.0,
          maxTokens: 2048,
          topP: 0.95,
        },
        output: null,
      },
    },
    {
      id: "gemini-2",
      type: "openRouter",
      position: { x: 860, y: 380 },
      data: {
        label: "OpenRouter LLM #2",
        inputs: {
          prompt: null,
          systemPrompt:
            "Condense the following product description into a tweet-length promotional hook (under 240 characters).",
          images: [],
          video: null,
          audio: null,
          file: null,
          temperature: 1.0,
          maxTokens: 2048,
          topP: 0.95,
        },
        output: null,
      },
    },
    {
      id: "gemini-final",
      type: "openRouter",
      position: { x: 1200, y: 220 },
      data: {
        label: "Final OpenRouter LLM",
        inputs: {
          prompt: null,
          systemPrompt:
            "You are a social media manager. Given a promotional hook and one or two cropped product images, write a final engaging advertisement post ready to publish.",
          images: [],
          video: null,
          audio: null,
          file: null,
          temperature: 1.0,
          maxTokens: 2048,
          topP: 0.95,
        },
        output: null,
      },
    },
    {
      id: "response",
      type: "response",
      position: { x: 1560, y: 220 },
      data: {
        label: "Output",
        results: [{ id: "result", label: "Final Post", value: null }],
      },
    },
  ];

  const edges = [
    {
      id: "edge-ri-image-crop1",
      source: "request-inputs",
      target: "crop-1",
      sourceHandle: "field_image_1",
      targetHandle: "in:inputImage",
      type: "animatedEdge",
    },
    {
      id: "edge-ri-image-crop2",
      source: "request-inputs",
      target: "crop-2",
      sourceHandle: "field_image_1",
      targetHandle: "in:inputImage",
      type: "animatedEdge",
    },
    {
      id: "edge-ri-text-gemini1",
      source: "request-inputs",
      target: "gemini-1",
      sourceHandle: "field_text_1",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-gemini1-gemini2",
      source: "gemini-1",
      target: "gemini-2",
      sourceHandle: "out:response",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-crop1-geminifinal",
      source: "crop-1",
      target: "gemini-final",
      sourceHandle: "out:outputImage",
      targetHandle: "in:images",
      type: "animatedEdge",
    },
    {
      id: "edge-crop2-geminifinal",
      source: "crop-2",
      target: "gemini-final",
      sourceHandle: "out:outputImage",
      targetHandle: "in:images",
      type: "animatedEdge",
    },
    {
      id: "edge-gemini2-geminifinal",
      source: "gemini-2",
      target: "gemini-final",
      sourceHandle: "out:response",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-geminifinal-response",
      source: "gemini-final",
      target: "response",
      sourceHandle: "out:response",
      targetHandle: "result",
      type: "animatedEdge",
    },
  ];

  return { nodes: clone(nodes), edges: clone(edges) };
}

export function resolveWorkflowGraph(options?: {
  template?: WorkflowTemplate;
  productBrief?: string;
}): { nodes: unknown[]; edges: unknown[] } {
  const template = options?.template ?? "empty";
  if (template === "advertisement") {
    return buildAdvertisementGraph(options?.productBrief);
  }
  return {
    nodes: clone(DEFAULT_EMPTY_NODES),
    edges: clone(DEFAULT_EMPTY_EDGES),
  };
}
