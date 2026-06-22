import MemoryClient from "mem0ai";
import type { UIMessage } from "ai";

type Mem0Client = InstanceType<typeof MemoryClient>;

let memoryClient: Mem0Client | null = null;

function getMemoryClient(): Mem0Client | null {
  const apiKey = process.env.MEM0_API_KEY;
  if (!apiKey) return null;

  if (!memoryClient) {
    memoryClient = new MemoryClient({ apiKey });
  }
  return memoryClient;
}

function extractLastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const text = m.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join(" ")
      .trim();
    if (text) return text;
  }
  return "";
}

function extractLastAssistantText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const text = m.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join(" ")
      .trim();
    if (text) return text.slice(0, 800);
  }
  return "";
}

function memoryMatchesMode(metadata: Record<string, unknown> | undefined, mode: string): boolean {
  if (!metadata) return true;
  const storedMode = metadata.mode;
  if (typeof storedMode !== "string") return true;
  return storedMode === mode;
}

/** Retrieve cross-session memory snippets for prompt injection (scoped by chat mode). */
export async function retrieveChatMemory(
  userId: string,
  mode: string,
  messages: UIMessage[],
): Promise<string> {
  if (mode === "helper") return "";

  const client = getMemoryClient();
  if (!client) return "";

  const query = extractLastUserText(messages);
  if (!query) return "";

  try {
    const hits = await client.search(query, { user_id: userId, limit: 12 });
    const lines = (hits ?? [])
      .filter((h) => memoryMatchesMode(h.metadata as Record<string, unknown> | undefined, mode))
      .map((h) => (h.memory ?? h.data?.memory ?? "").trim())
      .filter(Boolean)
      .slice(0, 5);
    if (lines.length === 0) return "";
    return `\n\nUSER MEMORY (${mode} — prior sessions, soft preference only):\n${lines.map((l) => `- ${l}`).join("\n")}`;
  } catch (err) {
    console.warn("[chat/memory] retrieve failed:", err);
    return "";
  }
}

/** Fire-and-forget memory write after a completed turn. */
export function persistChatMemoryTurn(
  userId: string,
  mode: string,
  chatId: string,
  messages: UIMessage[],
): void {
  if (mode === "helper") return;

  const client = getMemoryClient();
  if (!client) return;

  const userText = extractLastUserText(messages);
  const assistantText = extractLastAssistantText(messages);
  if (!userText) return;

  const payload: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: userText },
    ...(assistantText ? [{ role: "assistant" as const, content: assistantText }] : []),
  ];

  void client
    .add(payload, {
      user_id: userId,
      metadata: { mode, chatId },
    })
    .catch((err: unknown) => {
      console.warn("[chat/memory] persist failed:", err);
    });
}
