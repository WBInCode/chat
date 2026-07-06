-- AlterEnum
ALTER TYPE "OrgRole" ADD VALUE 'HR';

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "hash" TEXT,
ADD COLUMN     "prevHash" TEXT;

-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "disabledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "allowedEmailDomains" TEXT,
ADD COLUMN     "messageRetentionDays" INTEGER,
ADD COLUMN     "require2fa" BOOLEAN NOT NULL DEFAULT false;
