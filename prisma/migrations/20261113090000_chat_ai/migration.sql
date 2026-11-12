ALTER TYPE "ChatSender" ADD VALUE 'AI';

-- Existing conversations remain with people; only new conversations opt in.
ALTER TABLE "ChatConversation" ADD COLUMN "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "aiRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ChatConversation" ALTER COLUMN "aiEnabled" SET DEFAULT true;

CREATE TABLE "ChatAiDraft" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL UNIQUE REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL,
  "triggerMessageId" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "body" TEXT,
  "sendAt" TIMESTAMP(3),
  "leaseUntil" TIMESTAMP(3),
  "leaseToken" TEXT,
  "error" TEXT,
  "model" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ChatAiDraft_status_sendAt_idx" ON "ChatAiDraft"("status", "sendAt");
CREATE INDEX "ChatAiDraft_status_leaseUntil_idx" ON "ChatAiDraft"("status", "leaseUntil");
