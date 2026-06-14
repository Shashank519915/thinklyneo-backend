import { consumeStream } from "ai";

/** Passed to toUIMessageStreamResponse — drains SSE so onFinish runs on abort/disconnect. */
export const chatStreamConsumeSseStream = consumeStream;
