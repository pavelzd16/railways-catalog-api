CREATE TYPE "ChatSender" AS ENUM ('VISITOR', 'MANAGER');
CREATE TABLE "ChatConversation" (
  "id" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "visitorName" TEXT NOT NULL,
  "contact" TEXT, "pageUrl" TEXT, "policyAcceptedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "closed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatConversation_tokenHash_key" ON "ChatConversation"("tokenHash");
CREATE INDEX "ChatConversation_updatedAt_idx" ON "ChatConversation"("updatedAt");
CREATE TABLE "ChatMessage" (
  "id" SERIAL NOT NULL, "conversationId" TEXT NOT NULL, "clientId" TEXT NOT NULL,
  "sender" "ChatSender" NOT NULL, "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "readAt" TIMESTAMP(3),
  "notificationSentAt" TIMESTAMP(3), "notificationDueAt" TIMESTAMP(3), "notificationLockAt" TIMESTAMP(3),
  "notificationTries" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChatMessage_conversationId_sender_clientId_key" ON "ChatMessage"("conversationId", "sender", "clientId");
CREATE INDEX "ChatMessage_conversationId_id_idx" ON "ChatMessage"("conversationId", "id");
CREATE INDEX "ChatMessage_conversationId_sender_readAt_idx" ON "ChatMessage"("conversationId", "sender", "readAt");
CREATE INDEX "ChatMessage_notificationDueAt_idx" ON "ChatMessage"("notificationDueAt");
