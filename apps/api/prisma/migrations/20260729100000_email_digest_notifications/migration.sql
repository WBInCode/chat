-- Zbiorcze powiadomienia e-mail: preferencja per uzytkownik.
-- Domyslnie MENTIONS, czyli mail tylko dla wzmianek i wiadomosci
-- bezposrednich. Ustawienie na ALL lub OFF nalezy do uzytkownika.

-- CreateEnum
CREATE TYPE "EmailDigestMode" AS ENUM ('OFF', 'MENTIONS', 'ALL');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "emailDigest" "EmailDigestMode" NOT NULL DEFAULT 'MENTIONS';
