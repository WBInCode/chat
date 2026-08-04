-- CreateTable
CREATE TABLE "task_sources" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "searchUrl" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "taskUrlTemplate" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_sources_orgId_idx" ON "task_sources"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "task_sources_orgId_key_key" ON "task_sources"("orgId", "key");

-- AddForeignKey
ALTER TABLE "task_sources" ADD CONSTRAINT "task_sources_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
