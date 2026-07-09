-- CreateTable
CREATE TABLE "organization_modules" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'local',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_modules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_modules_orgId_idx" ON "organization_modules"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_modules_orgId_moduleKey_key" ON "organization_modules"("orgId", "moduleKey");

-- AddForeignKey
ALTER TABLE "organization_modules" ADD CONSTRAINT "organization_modules_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
