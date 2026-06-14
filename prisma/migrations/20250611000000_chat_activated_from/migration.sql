-- Add activatedFromChatId for brain activate idempotency
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "activatedFromChatId" TEXT;

CREATE INDEX IF NOT EXISTS "Chat_userId_activatedFromChatId_idx" ON "Chat"("userId", "activatedFromChatId");
