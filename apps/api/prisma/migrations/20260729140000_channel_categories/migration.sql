-- Kategorie kanałów, kolejność serwerowa, typ kanału i slowmode.
-- Etap 1 przebudowy zarządzania kanałami w stylu Discorda.

CREATE TYPE "ChannelKind" AS ENUM ('TEXT', 'ANNOUNCEMENT');

CREATE TABLE "channel_categories" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_categories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "channel_categories_orgId_position_idx" ON "channel_categories"("orgId", "position");

ALTER TABLE "channel_categories"
    ADD CONSTRAINT "channel_categories_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "channels" ADD COLUMN "kind" "ChannelKind" NOT NULL DEFAULT 'TEXT';
ALTER TABLE "channels" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "channels" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "channels" ADD COLUMN "slowmodeSeconds" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "channels"
    ADD CONSTRAINT "channels_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "channel_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "channels_orgId_categoryId_position_idx" ON "channels"("orgId", "categoryId", "position");

-- Istniejące kanały dostają kolejność zgodną z dotychczasowym widokiem
-- (rosnąco po dacie utworzenia), żeby po wdrożeniu nic nie przeskoczyło.
WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY "orgId" ORDER BY "createdAt" ASC) - 1 AS pos
    FROM "channels"
    WHERE "type" <> 'DM'
)
UPDATE "channels" c
SET "position" = ranked.pos
FROM ranked
WHERE c.id = ranked.id;
