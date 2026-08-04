-- Powiadomienia systemowe: kanał wyłącznie do czytania oraz źródła uprawnione
-- do wysyłania powiadomień do rozmów z nadawcą System.

ALTER TABLE "channels" ADD COLUMN "readOnly" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "system_notice_sources" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "noticeCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_notice_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "system_notice_sources_tokenHash_key" ON "system_notice_sources"("tokenHash");
CREATE UNIQUE INDEX "system_notice_sources_orgId_key_key" ON "system_notice_sources"("orgId", "key");
CREATE INDEX "system_notice_sources_orgId_idx" ON "system_notice_sources"("orgId");

ALTER TABLE "system_notice_sources"
    ADD CONSTRAINT "system_notice_sources_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
