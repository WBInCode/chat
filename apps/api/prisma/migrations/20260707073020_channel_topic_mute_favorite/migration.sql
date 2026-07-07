-- AlterTable
ALTER TABLE "channel_members" ADD COLUMN     "favorite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mutedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "topic" TEXT;
