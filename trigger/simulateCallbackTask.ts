import { STUB_DEMO_IMAGE_URL, STUB_DEMO_VIDEO_MP4_URL } from "@shashank519915/shared";
import { task, wait, tasks } from "@trigger.dev/sdk/v3";

interface SimulateCallbackPayload {
  tokenId: string;
  nodeType: "gptImage2" | "klingV3";
  prompt: string;
  delaySeconds?: number;
}

export const simulateCallbackTask = task({
  id: "simulate-callback",
  maxDuration: 120, // 2 minutes max — covers the 12s delay + buffer
  run: async (payload: SimulateCallbackPayload) => {
    const { tokenId, nodeType, prompt, delaySeconds = 10 } = payload;

    console.log(`[SimulateCallback] ⏳ Waiting ${delaySeconds}s before completing token ${tokenId} for node ${nodeType}...`);
    await wait.for({ seconds: delaySeconds });

    let output = "";
    if (nodeType === "gptImage2") {
      output = STUB_DEMO_IMAGE_URL;
    } else if (nodeType === "klingV3") {
      output = STUB_DEMO_VIDEO_MP4_URL;
    }

    console.log(`[SimulateCallback] 📤 Completing waitpoint token ${tokenId} with output URL: ${output}`);
    
    // Complete the waitpoint token, which resumes the suspended node task
    await wait.completeToken(tokenId, { output });

    return { success: true, output };
  },
});
