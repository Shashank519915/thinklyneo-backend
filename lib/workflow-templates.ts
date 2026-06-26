/**
 * Canonical workflow graph templates for API and MCP creation.
 */

export const WORKFLOW_TEMPLATES = [
  "empty",
  "advertisement",
  "youtubeShorts",
  "audioDubbing",
  "podcastTeaser",
  "newsSummarizer",
  "cinematicTeaser",
  "socialMediaCampaign",
  "voiceoverVideo",
  "videoLocalizer"
] as const;
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
          image_urls: [],
          video_urls: [],
          audio_urls: [],
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
          image_urls: [],
          video_urls: [],
          audio_urls: [],
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
          image_urls: [],
          video_urls: [],
          audio_urls: [],
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
      targetHandle: "in:image_urls",
      type: "animatedEdge",
    },
    {
      id: "edge-crop2-geminifinal",
      source: "crop-2",
      target: "gemini-final",
      sourceHandle: "out:outputImage",
      targetHandle: "in:image_urls",
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

/** YouTube Shorts Creator: script LLM + kling backing video + backing music AV merge */
export function buildYoutubeShortsGraph() {
  const nodes = [
    {
      id: "request-inputs",
      type: "requestInputs",
      position: { x: 50, y: 250 },
      data: {
        label: "Request-Inputs",
        fields: [
          {
            id: "field_text_prompt",
            type: "text_field",
            label: "Video Script & Theme",
            value: "A space exploration video showing Mars landers under heavy storms.",
            linkedTarget: { nodeId: "gemini-script", handle: "in:prompt" },
          },
          {
            id: "field_audio_bg",
            type: "audio_field",
            label: "Backing Audio File",
            value: null,
            linkedTarget: { nodeId: "extract-audio-bg", handle: "in:audio_url" },
          },
        ],
      },
    },
    {
      id: "gemini-script",
      type: "openRouter",
      position: { x: 450, y: 80 },
      data: {
        label: "Gemini Video Script",
        inputs: {
          prompt: null,
          systemPrompt: "Write a high-energy 1-paragraph narrator script for a 5-second video clip.",
          temperature: 0.9,
          maxTokens: 1024,
        },
        output: null,
      },
    },
    {
      id: "kling-video",
      type: "klingV3",
      position: { x: 800, y: 80 },
      data: {
        label: "Kling Backing Video",
        inputs: {
          prompt: null,
          aspect_ratio: "9:16",
          duration: 5,
        },
        output: null,
      },
    },
    {
      id: "extract-audio-bg",
      type: "extractAudio",
      position: { x: 450, y: 420 },
      data: {
        label: "Extract Background Audio",
        inputs: {
          audio_url: null,
          format: "mp3",
        },
        output: null,
      },
    },
    {
      id: "merge-av-shorts",
      type: "mergeAV",
      position: { x: 1150, y: 220 },
      data: {
        label: "Merge Audio & Video",
        inputs: {
          video_url: null,
          audio_url: null,
          video_volume: 0.0,
          audio_volume: 1.0,
        },
        output: null,
      },
    },
    {
      id: "response",
      type: "response",
      position: { x: 1500, y: 220 },
      data: {
        label: "Output",
        results: [{ id: "result_video", label: "Final Shorts Video", value: null }],
      },
    },
  ];

  const edges = [
    {
      id: "edge-shorts-prompt-script",
      source: "request-inputs",
      target: "gemini-script",
      sourceHandle: "field_text_prompt",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-shorts-audio-extract",
      source: "request-inputs",
      target: "extract-audio-bg",
      sourceHandle: "field_audio_bg",
      targetHandle: "in:audio_url",
      type: "animatedEdge",
    },
    {
      id: "edge-shorts-script-kling",
      source: "gemini-script",
      target: "kling-video",
      sourceHandle: "out:response",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-shorts-kling-merge",
      source: "kling-video",
      target: "merge-av-shorts",
      sourceHandle: "out:result",
      targetHandle: "in:video_url",
      type: "animatedEdge",
    },
    {
      id: "edge-shorts-extract-merge",
      source: "extract-audio-bg",
      target: "merge-av-shorts",
      sourceHandle: "out:outputAudio",
      targetHandle: "in:audio_url",
      type: "animatedEdge",
    },
    {
      id: "edge-shorts-merge-response",
      source: "merge-av-shorts",
      target: "response",
      sourceHandle: "out:outputVideo",
      targetHandle: "result_video",
      type: "animatedEdge",
    },
  ];

  return { nodes: clone(nodes), edges: clone(edges) };
}

/** Audio Dubber: extract audio → translate to target language text → summarize transcript */
export function buildAudioDubbingGraph() {
  const nodes = [
    {
      id: "request-inputs",
      type: "requestInputs",
      position: { x: 50, y: 250 },
      data: {
        label: "Request-Inputs",
        fields: [
          {
            id: "field_video_source",
            type: "video_field",
            label: "Source Video/Audio File",
            value: null,
            linkedTarget: { nodeId: "extract-raw-audio", handle: "in:video_url" },
          },
          {
            id: "field_text_target_lang",
            type: "text_field",
            label: "Target Translation Instructions",
            value: "Translate spoken words to French.",
            linkedTarget: { nodeId: "gemini-translate", handle: "in:prompt" },
          },
        ],
      },
    },
    {
      id: "extract-raw-audio",
      type: "extractAudio",
      position: { x: 450, y: 80 },
      data: {
        label: "Extract Raw Audio",
        inputs: {
          video_url: null,
          format: "wav",
        },
        output: null,
      },
    },
    {
      id: "gemini-translate",
      type: "gemini",
      position: { x: 800, y: 220 },
      data: {
        label: "Gemini Translator",
        inputs: {
          prompt: null,
          audio_urls: [],
          temperature: 0.2,
          maxTokens: 2048,
        },
        output: null,
      },
    },
    {
      id: "openrouter-summarize",
      type: "openRouter",
      position: { x: 1150, y: 360 },
      data: {
        label: "OpenRouter Summarizer",
        inputs: {
          prompt: null,
          systemPrompt: "Generate a bulleted summary of this translation.",
          temperature: 0.5,
          maxTokens: 1024,
        },
        output: null,
      },
    },
    {
      id: "response",
      type: "response",
      position: { x: 1500, y: 200 },
      data: {
        label: "Output",
        results: [
          { id: "result_translation", label: "French Translation", value: null },
          { id: "result_summary", label: "Executive Summary", value: null },
        ],
      },
    },
  ];

  const edges = [
    {
      id: "edge-dub-video-extract",
      source: "request-inputs",
      target: "extract-raw-audio",
      sourceHandle: "field_video_source",
      targetHandle: "in:video_url",
      type: "animatedEdge",
    },
    {
      id: "edge-dub-lang-translate",
      source: "request-inputs",
      target: "gemini-translate",
      sourceHandle: "field_text_target_lang",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-dub-audio-translate",
      source: "extract-raw-audio",
      target: "gemini-translate",
      sourceHandle: "out:outputAudio",
      targetHandle: "in:audio_urls",
      type: "animatedEdge",
    },
    {
      id: "edge-dub-translate-summarize",
      source: "gemini-translate",
      target: "openrouter-summarize",
      sourceHandle: "out:response",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-dub-translate-response",
      source: "gemini-translate",
      target: "response",
      sourceHandle: "out:response",
      targetHandle: "result_translation",
      type: "animatedEdge",
    },
    {
      id: "edge-dub-summarize-response",
      source: "openrouter-summarize",
      target: "response",
      sourceHandle: "out:response",
      targetHandle: "result_summary",
      type: "animatedEdge",
    },
  ];

  return { nodes: clone(nodes), edges: clone(edges) };
}

/** Podcast Teaser Creator: Crop Watermark logo + extract audio + teaser writer */
export function buildPodcastTeaserGraph() {
  const nodes = [
    {
      id: "request-inputs",
      type: "requestInputs",
      position: { x: 50, y: 250 },
      data: {
        label: "Request-Inputs",
        fields: [
          {
            id: "field_video_podcast",
            type: "video_field",
            label: "Full Podcast Video Clip",
            value: null,
            linkedTarget: { nodeId: "extract-podcast-audio", handle: "in:video_url" },
          },
          {
            id: "field_image_logo",
            type: "image_field",
            label: "Branding Watermark Logo",
            value: null,
            linkedTarget: { nodeId: "crop-podcast-logo", handle: "in:inputImage" },
          },
        ],
      },
    },
    {
      id: "crop-podcast-logo",
      type: "cropImage",
      position: { x: 450, y: 80 },
      data: {
        label: "Crop Watermark Logo",
        inputs: { inputImage: null, x: 10, y: 10, w: 80, h: 80 },
        output: null,
      },
    },
    {
      id: "extract-podcast-audio",
      type: "extractAudio",
      position: { x: 450, y: 420 },
      data: {
        label: "Extract Podcast Audio",
        inputs: {
          video_url: null,
          format: "mp3",
        },
        output: null,
      },
    },
    {
      id: "gemini-teaser",
      type: "gemini",
      position: { x: 850, y: 300 },
      data: {
        label: "Gemini Teaser Writer",
        inputs: {
          prompt: "Extract key timestamps and draft a teaser post explaining what the episode covers.",
          audio_urls: [],
          temperature: 0.7,
          maxTokens: 1024,
        },
        output: null,
      },
    },
    {
      id: "response",
      type: "response",
      position: { x: 1250, y: 200 },
      data: {
        label: "Output",
        results: [
          { id: "result_logo_cropped", label: "Cropped Logo", value: null },
          { id: "result_teaser_text", label: "Social Media Teaser Post", value: null },
        ],
      },
    },
  ];

  const edges = [
    {
      id: "edge-podcast-video-extract",
      source: "request-inputs",
      target: "extract-podcast-audio",
      sourceHandle: "field_video_podcast",
      targetHandle: "in:video_url",
      type: "animatedEdge",
    },
    {
      id: "edge-podcast-logo-crop",
      source: "request-inputs",
      target: "crop-podcast-logo",
      sourceHandle: "field_image_logo",
      targetHandle: "in:inputImage",
      type: "animatedEdge",
    },
    {
      id: "edge-podcast-audio-teaser",
      source: "extract-podcast-audio",
      target: "gemini-teaser",
      sourceHandle: "out:outputAudio",
      targetHandle: "in:audio_urls",
      type: "animatedEdge",
    },
    {
      id: "edge-podcast-crop-response",
      source: "crop-podcast-logo",
      target: "response",
      sourceHandle: "out:outputImage",
      targetHandle: "result_logo_cropped",
      type: "animatedEdge",
    },
    {
      id: "edge-podcast-teaser-response",
      source: "gemini-teaser",
      target: "response",
      sourceHandle: "out:response",
      targetHandle: "result_teaser_text",
      type: "animatedEdge",
    },
  ];

  return { nodes: clone(nodes), edges: clone(edges) };
}

/** News Summarizer: Crop Banner + Summarize text article + GPT illustration image generator */
export function buildNewsSummarizerGraph() {
  const nodes = [
    {
      id: "request-inputs",
      type: "requestInputs",
      position: { x: 50, y: 250 },
      data: {
        label: "Request-Inputs",
        fields: [
          {
            id: "field_text_article",
            type: "text_field",
            label: "Full News Article Text / URL",
            value: "Mars Rovers find traces of organic compounds under ancient lake bed. Heavy sandstorms complicate communications.",
            linkedTarget: { nodeId: "openrouter-article-sum", handle: "in:prompt" },
          },
          {
            id: "field_image_banner",
            type: "image_field",
            label: "News Banner Image",
            value: null,
            linkedTarget: { nodeId: "crop-news-banner", handle: "in:inputImage" },
          },
        ],
      },
    },
    {
      id: "crop-news-banner",
      type: "cropImage",
      position: { x: 450, y: 80 },
      data: {
        label: "Crop Header Banner",
        inputs: { inputImage: null, x: 0, y: 10, w: 100, h: 60 },
        output: null,
      },
    },
    {
      id: "openrouter-article-sum",
      type: "openRouter",
      position: { x: 450, y: 420 },
      data: {
        label: "Article Summarizer",
        inputs: {
          prompt: null,
          systemPrompt: "Summarize this article in 3 short, punchy bullet points for a daily newsletter.",
          temperature: 0.3,
          maxTokens: 1024,
        },
        output: null,
      },
    },
    {
      id: "gpt-illustration",
      type: "gptImage2",
      position: { x: 850, y: 420 },
      data: {
        label: "GPT Editorial Image",
        inputs: {
          prompt: null,
          size: "2048x2048",
        },
        output: null,
      },
    },
    {
      id: "response",
      type: "response",
      position: { x: 1250, y: 250 },
      data: {
        label: "Output",
        results: [
          { id: "result_banner", label: "Cropped Header Banner", value: null },
          { id: "result_summary", label: "Newsletter Summary", value: null },
          { id: "result_illustration", label: "Generated Illustration Image", value: null },
        ],
      },
    },
  ];

  const edges = [
    {
      id: "edge-news-text-sum",
      source: "request-inputs",
      target: "openrouter-article-sum",
      sourceHandle: "field_text_article",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-news-banner-crop",
      source: "request-inputs",
      target: "crop-news-banner",
      sourceHandle: "field_image_banner",
      targetHandle: "in:inputImage",
      type: "animatedEdge",
    },
    {
      id: "edge-news-sum-gpt",
      source: "openrouter-article-sum",
      target: "gpt-illustration",
      sourceHandle: "out:response",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-news-crop-response",
      source: "crop-news-banner",
      target: "response",
      sourceHandle: "out:outputImage",
      targetHandle: "result_banner",
      type: "animatedEdge",
    },
    {
      id: "edge-news-sum-response",
      source: "openrouter-article-sum",
      target: "response",
      sourceHandle: "out:response",
      targetHandle: "result_summary",
      type: "animatedEdge",
    },
    {
      id: "edge-news-gpt-response",
      source: "gpt-illustration",
      target: "response",
      sourceHandle: "out:result",
      targetHandle: "result_illustration",
      type: "animatedEdge",
    },
  ];

  return { nodes: clone(nodes), edges: clone(edges) };
}

/** Cinematic Teaser Creator: script LLM + visual board image + kling backing video generator */
export function buildCinematicTeaserGraph() {
  const nodes = [
    {
      id: "request-inputs",
      type: "requestInputs",
      position: { x: 50, y: 250 },
      data: {
        label: "Request-Inputs",
        fields: [
          {
            id: "field_text_concept",
            type: "text_field",
            label: "Cinematic Concept Prompt",
            value: "A futuristic cyberpunk detective standing in heavy neon rain looking at a giant hologram.",
            linkedTarget: { nodeId: "openrouter-script", handle: "in:prompt" },
          },
          {
            id: "field_image_reference",
            type: "image_field",
            label: "Reference Mood Image",
            value: null,
            linkedTarget: { nodeId: "kling-teaser", handle: "in:start_image_url" },
          },
        ],
      },
    },
    {
      id: "openrouter-script",
      type: "openRouter",
      position: { x: 450, y: 80 },
      data: {
        label: "Teaser Screenwriter",
        inputs: {
          prompt: null,
          systemPrompt: "Write a short, highly-descriptive visual prompt (1 sentence) for an image generator representing this scene.",
          temperature: 0.8,
          maxTokens: 1024,
        },
        output: null,
      },
    },
    {
      id: "gpt-moodboard",
      type: "gptImage2",
      position: { x: 800, y: 80 },
      data: {
        label: "Moodboard Graphic Generator",
        inputs: {
          prompt: null,
          size: "2048x1152",
        },
        output: null,
      },
    },
    {
      id: "kling-teaser",
      type: "klingV3",
      position: { x: 1150, y: 80 },
      data: {
        label: "Cinematic B-Roll Generator",
        inputs: {
          prompt: "Cinematic, realistic camera pan, neon rain reflecting, 4k",
          aspect_ratio: "16:9",
          duration: 5,
        },
        output: null,
      },
    },
    {
      id: "gemini-voiceover",
      type: "gemini",
      position: { x: 800, y: 420 },
      data: {
        label: "Voiceover Scriptwriter",
        inputs: {
          prompt: null,
          systemPrompt: "Write a dramatic, low-voice 1-sentence narrator voiceover script for a teaser trailer.",
          temperature: 0.75,
        },
        output: null,
      },
    },
    {
      id: "response",
      type: "response",
      position: { x: 1500, y: 250 },
      data: {
        label: "Output",
        results: [
          { id: "result_video", label: "Cinematic B-Roll Video", value: null },
          { id: "result_illustration", label: "Moodboard Keyframe", value: null },
          { id: "result_script", label: "Voiceover Narration Script", value: null },
        ],
      },
    },
  ];

  const edges = [
    {
      id: "edge-cinematic-concept-script",
      source: "request-inputs",
      target: "openrouter-script",
      sourceHandle: "field_text_concept",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-cinematic-ref-kling",
      source: "request-inputs",
      target: "kling-teaser",
      sourceHandle: "field_image_reference",
      targetHandle: "in:start_image_url",
      type: "animatedEdge",
    },
    {
      id: "edge-cinematic-script-gpt",
      source: "openrouter-script",
      target: "gpt-moodboard",
      sourceHandle: "out:response",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-cinematic-script-gemini",
      source: "openrouter-script",
      target: "gemini-voiceover",
      sourceHandle: "out:response",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-cinematic-gpt-kling",
      source: "gpt-moodboard",
      target: "kling-teaser",
      sourceHandle: "out:result",
      targetHandle: "in:start_image_url",
      type: "animatedEdge",
    },
    {
      id: "edge-cinematic-kling-response",
      source: "kling-teaser",
      target: "response",
      sourceHandle: "out:result",
      targetHandle: "result_video",
      type: "animatedEdge",
    },
    {
      id: "edge-cinematic-gpt-response",
      source: "gpt-moodboard",
      target: "response",
      sourceHandle: "out:result",
      targetHandle: "result_illustration",
      type: "animatedEdge",
    },
    {
      id: "edge-cinematic-voiceover-response",
      source: "gemini-voiceover",
      target: "response",
      sourceHandle: "out:response",
      targetHandle: "result_script",
      type: "animatedEdge",
    },
  ];

  return { nodes: clone(nodes), edges: clone(edges) };
}

/** Social Media Campaign: brand ad copy + square/landscape watermark logo crops */
export function buildSocialMediaCampaignGraph() {
  const nodes = [
    {
      id: "request-inputs",
      type: "requestInputs",
      position: { x: 50, y: 250 },
      data: {
        label: "Request-Inputs",
        fields: [
          {
            id: "field_text_brand_desc",
            type: "text_field",
            label: "Brand Description",
            value: "Sustainable organic coffee brand targeting young professionals who value carbon-neutral sourcing.",
            linkedTarget: { nodeId: "gemini-copy", handle: "in:prompt" },
          },
          {
            id: "field_image_logo",
            type: "image_field",
            label: "Logo Banner Graphic",
            value: null,
            linkedTarget: { nodeId: "crop-square", handle: "in:inputImage" },
          },
        ],
      },
    },
    {
      id: "crop-square",
      type: "cropImage",
      position: { x: 450, y: 80 },
      data: {
        label: "Crop Square Banner",
        inputs: { inputImage: null, x: 10, y: 10, w: 80, h: 80 },
        output: null,
      },
    },
    {
      id: "crop-landscape",
      type: "cropImage",
      position: { x: 450, y: 420 },
      data: {
        label: "Crop Landscape Banner",
        inputs: { inputImage: null, x: 0, y: 20, w: 100, h: 60 },
        output: null,
      },
    },
    {
      id: "gemini-copy",
      type: "gemini",
      position: { x: 800, y: 220 },
      data: {
        label: "Campaign Ad Copy Writer",
        inputs: {
          prompt: null,
          systemPrompt: "You are an expert advertiser. Write a compelling, punchy Instagram caption based on the brand description provided.",
          temperature: 0.85,
        },
        output: null,
      },
    },
    {
      id: "openrouter-seo",
      type: "openRouter",
      position: { x: 1150, y: 220 },
      data: {
        label: "Hashtag & SEO Optimizer",
        inputs: {
          prompt: null,
          systemPrompt: "Generate 5 high-performing hashtags and a meta SEO title from the provided ad copy.",
          temperature: 0.5,
        },
        output: null,
      },
    },
    {
      id: "response",
      type: "response",
      position: { x: 1500, y: 220 },
      data: {
        label: "Output",
        results: [
          { id: "result_square_crop", label: "Square Brand Banner", value: null },
          { id: "result_landscape_crop", label: "Landscape Brand Banner", value: null },
          { id: "result_ad_copy", label: "Campaign Caption Copy", value: null },
          { id: "result_seo_tags", label: "Optimized SEO & Hashtags", value: null },
        ],
      },
    },
  ];

  const edges = [
    {
      id: "edge-campaign-brand-copy",
      source: "request-inputs",
      target: "gemini-copy",
      sourceHandle: "field_text_brand_desc",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-campaign-logo-crop1",
      source: "request-inputs",
      target: "crop-square",
      sourceHandle: "field_image_logo",
      targetHandle: "in:inputImage",
      type: "animatedEdge",
    },
    {
      id: "edge-campaign-logo-crop2",
      source: "request-inputs",
      target: "crop-landscape",
      sourceHandle: "field_image_logo",
      targetHandle: "in:inputImage",
      type: "animatedEdge",
    },
    {
      id: "edge-campaign-copy-seo",
      source: "gemini-copy",
      target: "openrouter-seo",
      sourceHandle: "out:response",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-campaign-crop1-response",
      source: "crop-square",
      target: "response",
      sourceHandle: "out:outputImage",
      targetHandle: "result_square_crop",
      type: "animatedEdge",
    },
    {
      id: "edge-campaign-crop2-response",
      source: "crop-landscape",
      target: "response",
      sourceHandle: "out:outputImage",
      targetHandle: "result_landscape_crop",
      type: "animatedEdge",
    },
    {
      id: "edge-campaign-copy-response",
      source: "gemini-copy",
      target: "response",
      sourceHandle: "out:response",
      targetHandle: "result_ad_copy",
      type: "animatedEdge",
    },
    {
      id: "edge-campaign-seo-response",
      source: "openrouter-seo",
      target: "response",
      sourceHandle: "out:response",
      targetHandle: "result_seo_tags",
      type: "animatedEdge",
    },
  ];

  return { nodes: clone(nodes), edges: clone(edges) };
}

/** Voiceover Video Creator: video sound extractor + narration translation & illustration generator + backing B-roll loop + audio/video merge */
export function buildVoiceoverVideoGraph() {
  const nodes = [
    {
      id: "request-inputs",
      type: "requestInputs",
      position: { x: 50, y: 250 },
      data: {
        label: "Request-Inputs",
        fields: [
          {
            id: "field_video_source",
            type: "video_field",
            label: "Source Talking-Head Video",
            value: null,
            linkedTarget: { nodeId: "extract-audio", handle: "in:videoUrl" },
          },
          {
            id: "field_text_style",
            type: "text_field",
            label: "Illustration Aesthetic Style",
            value: "Watercolor vintage space painting, detailed, cinematic lighting",
            linkedTarget: { nodeId: "gemini-prompt-writer", handle: "in:prompt" },
          },
        ],
      },
    },
    {
      id: "extract-audio",
      type: "extractAudio",
      position: { x: 450, y: 80 },
      data: {
        label: "Extract Source Audio",
        inputs: {
          videoUrl: null,
          format: "mp3",
        },
        output: null,
      },
    },
    {
      id: "gemini-prompt-writer",
      type: "gemini",
      position: { x: 800, y: 220 },
      data: {
        label: "Illustration Prompt Director",
        inputs: {
          prompt: null,
          systemPrompt: "You are an art director. Listen to this audio transcript style request and construct a highly detailed 1-sentence prompt for DALL-E.",
          audio_urls: [],
          temperature: 0.6,
        },
        output: null,
      },
    },
    {
      id: "gpt-backing",
      type: "gptImage2",
      position: { x: 1150, y: 80 },
      data: {
        label: "Backing Scene Illustrator",
        inputs: {
          prompt: null,
          size: "3840x2160",
        },
        output: null,
      },
    },
    {
      id: "kling-broll",
      type: "klingV3",
      position: { x: 1500, y: 80 },
      data: {
        label: "Backing B-Roll Loop",
        inputs: {
          prompt: "Cinematic, slow camera glide, high quality",
          aspect_ratio: "16:9",
          duration: 5,
        },
        output: null,
      },
    },
    {
      id: "merge-av",
      type: "mergeAV",
      position: { x: 1850, y: 250 },
      data: {
        label: "Sync Original Audio to Video",
        inputs: {
          video_url: null,
          audio_url: null,
          video_volume: 0.0,
          audio_volume: 1.0,
        },
        output: null,
      },
    },
    {
      id: "response",
      type: "response",
      position: { x: 2200, y: 250 },
      data: {
        label: "Output",
        results: [
          { id: "result_final_video", label: "Final Merged B-Roll Video", value: null },
          { id: "result_illustration", label: "Generated Backdrop Image", value: null },
        ],
      },
    },
  ];

  const edges = [
    {
      id: "edge-voiceover-video-extract",
      source: "request-inputs",
      target: "extract-audio",
      sourceHandle: "field_video_source",
      targetHandle: "in:videoUrl",
      type: "animatedEdge",
    },
    {
      id: "edge-voiceover-style-gemini",
      source: "request-inputs",
      target: "gemini-prompt-writer",
      sourceHandle: "field_text_style",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-voiceover-audio-gemini",
      source: "extract-audio",
      target: "gemini-prompt-writer",
      sourceHandle: "out:outputAudio",
      targetHandle: "in:audio_urls",
      type: "animatedEdge",
    },
    {
      id: "edge-voiceover-gemini-gpt",
      source: "gemini-prompt-writer",
      target: "gpt-backing",
      sourceHandle: "out:response",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-voiceover-gpt-kling",
      source: "gpt-backing",
      target: "kling-broll",
      sourceHandle: "out:result",
      targetHandle: "in:start_image_url",
      type: "animatedEdge",
    },
    {
      id: "edge-voiceover-kling-merge",
      source: "kling-broll",
      target: "merge-av",
      sourceHandle: "out:result",
      targetHandle: "in:video_url",
      type: "animatedEdge",
    },
    {
      id: "edge-voiceover-audio-merge",
      source: "extract-audio",
      target: "merge-av",
      sourceHandle: "out:outputAudio",
      targetHandle: "in:audio_url",
      type: "animatedEdge",
    },
    {
      id: "edge-voiceover-merge-response",
      source: "merge-av",
      target: "response",
      sourceHandle: "out:outputVideo",
      targetHandle: "result_final_video",
      type: "animatedEdge",
    },
    {
      id: "edge-voiceover-gpt-response",
      source: "gpt-backing",
      target: "response",
      sourceHandle: "out:result",
      targetHandle: "result_illustration",
      type: "animatedEdge",
    },
  ];

  return { nodes: clone(nodes), edges: clone(edges) };
}

/** Video Localizer: original audio extractor + language translator + title card designer + title graphic generator */
export function buildVideoLocalizerGraph() {
  const nodes = [
    {
      id: "request-inputs",
      type: "requestInputs",
      position: { x: 50, y: 250 },
      data: {
        label: "Request-Inputs",
        fields: [
          {
            id: "field_video_clip",
            type: "video_field",
            label: "Original Video Clip",
            value: null,
            linkedTarget: { nodeId: "extract-local-audio", handle: "in:videoUrl" },
          },
          {
            id: "field_text_target_lang",
            type: "text_field",
            label: "Target Language Name",
            value: "Spanish",
            linkedTarget: { nodeId: "gemini-translator", handle: "in:prompt" },
          },
        ],
      },
    },
    {
      id: "extract-local-audio",
      type: "extractAudio",
      position: { x: 450, y: 80 },
      data: {
        label: "Extract Original Audio",
        inputs: {
          videoUrl: null,
          format: "wav",
        },
        output: null,
      },
    },
    {
      id: "gemini-translator",
      type: "gemini",
      position: { x: 800, y: 220 },
      data: {
        label: "Audio Translator",
        inputs: {
          prompt: null,
          systemPrompt: "Listen to the spoken audio and translate it fully into the target language.",
          audio_urls: [],
          temperature: 0.3,
        },
        output: null,
      },
    },
    {
      id: "openrouter-titlecard",
      type: "openRouter",
      position: { x: 1150, y: 360 },
      data: {
        label: "Title Card Writer",
        inputs: {
          prompt: null,
          systemPrompt: "Based on this translation, write a short, cinematic 3-4 word title card phrase in that same target language. Quote the final phrase.",
          temperature: 0.6,
        },
        output: null,
      },
    },
    {
      id: "gpt-graphic",
      type: "gptImage2",
      position: { x: 1500, y: 360 },
      data: {
        label: "Title Card Graphic Designer",
        inputs: {
          prompt: null,
          size: "2048x1152",
        },
        output: null,
      },
    },
    {
      id: "response",
      type: "response",
      position: { x: 1850, y: 250 },
      data: {
        label: "Output",
        results: [
          { id: "result_translation", label: "Translated Script", value: null },
          { id: "result_title_card", label: "Title Card Background Image", value: null },
        ],
      },
    },
  ];

  const edges = [
    {
      id: "edge-localizer-video-extract",
      source: "request-inputs",
      target: "extract-local-audio",
      sourceHandle: "field_video_clip",
      targetHandle: "in:videoUrl",
      type: "animatedEdge",
    },
    {
      id: "edge-localizer-lang-translator",
      source: "request-inputs",
      target: "gemini-translator",
      sourceHandle: "field_text_target_lang",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-localizer-audio-translator",
      source: "extract-local-audio",
      target: "gemini-translator",
      sourceHandle: "out:outputAudio",
      targetHandle: "in:audio_urls",
      type: "animatedEdge",
    },
    {
      id: "edge-localizer-translator-writer",
      source: "gemini-translator",
      target: "openrouter-titlecard",
      sourceHandle: "out:response",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-localizer-writer-gpt",
      source: "openrouter-titlecard",
      target: "gpt-graphic",
      sourceHandle: "out:response",
      targetHandle: "in:prompt",
      type: "animatedEdge",
    },
    {
      id: "edge-localizer-translator-response",
      source: "gemini-translator",
      target: "response",
      sourceHandle: "out:response",
      targetHandle: "result_translation",
      type: "animatedEdge",
    },
    {
      id: "edge-localizer-gpt-response",
      source: "gpt-graphic",
      target: "response",
      sourceHandle: "out:result",
      targetHandle: "result_title_card",
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
  if (template === "youtubeShorts") {
    return buildYoutubeShortsGraph();
  }
  if (template === "audioDubbing") {
    return buildAudioDubbingGraph();
  }
  if (template === "podcastTeaser") {
    return buildPodcastTeaserGraph();
  }
  if (template === "newsSummarizer") {
    return buildNewsSummarizerGraph();
  }
  if (template === "cinematicTeaser") {
    return buildCinematicTeaserGraph();
  }
  if (template === "socialMediaCampaign") {
    return buildSocialMediaCampaignGraph();
  }
  if (template === "voiceoverVideo") {
    return buildVoiceoverVideoGraph();
  }
  if (template === "videoLocalizer") {
    return buildVideoLocalizerGraph();
  }
  return {
    nodes: clone(DEFAULT_EMPTY_NODES),
    edges: clone(DEFAULT_EMPTY_EDGES),
  };
}
