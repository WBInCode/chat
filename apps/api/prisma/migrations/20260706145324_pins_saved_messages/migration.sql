-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "pinnedAt" TIMESTAMP(3),
ADD COLUMN     "pinnedBy" TEXT;

-- CreateTable
CREATE TABLE "saved_messages" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_messages_userId_createdAt_idx" ON "saved_messages"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "saved_messages_userId_messageId_key" ON "saved_messages"("userId", "messageId");

-- CreateIndex
CREATE INDEX "messages_channelId_pinnedAt_idx" ON "messages"("channelId", "pinnedAt");

-- AddForeignKey
ALTER TABLE "saved_messages" ADD CONSTRAINT "saved_messages_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
