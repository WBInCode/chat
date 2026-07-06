-- CreateTable
CREATE TABLE "link_embeds" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "imageKey" TEXT,
    "siteName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_embeds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "link_embeds_messageId_idx" ON "link_embeds"("messageId");

-- AddForeignKey
ALTER TABLE "link_embeds" ADD CONSTRAINT "link_embeds_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
