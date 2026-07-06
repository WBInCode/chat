-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "data_exports" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "requestedById" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'PENDING',
    "key" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_exports_targetUserId_idx" ON "data_exports"("targetUserId");

-- AddForeignKey
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
