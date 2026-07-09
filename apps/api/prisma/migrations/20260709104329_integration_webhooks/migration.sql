-- CreateTable
CREATE TABLE "integration_webhooks" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "botUserId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_webhooks_tokenHash_key" ON "integration_webhooks"("tokenHash");

-- CreateIndex
CREATE INDEX "integration_webhooks_channelId_idx" ON "integration_webhooks"("channelId");

-- CreateIndex
CREATE INDEX "integration_webhooks_orgId_idx" ON "integration_webhooks"("orgId");

-- AddForeignKey
ALTER TABLE "integration_webhooks" ADD CONSTRAINT "integration_webhooks_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
