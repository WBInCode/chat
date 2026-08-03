-- Kategorie prywatne: flaga na kategorii i lista osób z dostępem.
-- Kategoria prywatna jest widoczna wyłącznie dla osób z tej listy oraz dla
-- uprawnienia channel.manage. Kanały w środku muszą być prywatne, inaczej
-- publiczny kanał przeciekałby spod ukrytego nagłówka.

ALTER TABLE "channel_categories" ADD COLUMN "private" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "channel_category_members" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_category_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channel_category_members_categoryId_userId_key"
    ON "channel_category_members"("categoryId", "userId");

CREATE INDEX "channel_category_members_userId_idx" ON "channel_category_members"("userId");

ALTER TABLE "channel_category_members"
    ADD CONSTRAINT "channel_category_members_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "channel_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "channel_category_members"
    ADD CONSTRAINT "channel_category_members_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
