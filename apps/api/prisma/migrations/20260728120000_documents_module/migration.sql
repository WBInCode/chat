-- Documents module (F8): shared per-channel documents built from ordered
-- blocks, with revision snapshots and per-block comments.

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "icon" TEXT,
    "createdBy" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_blocks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_revisions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "authorId" TEXT,
    "summary" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_comments" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "blockId" TEXT,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_channelId_updatedAt_idx" ON "documents"("channelId", "updatedAt");
CREATE INDEX "documents_orgId_idx" ON "documents"("orgId");
CREATE INDEX "document_blocks_documentId_position_idx" ON "document_blocks"("documentId", "position");
CREATE INDEX "document_revisions_documentId_createdAt_idx" ON "document_revisions"("documentId", "createdAt");
CREATE INDEX "document_comments_documentId_createdAt_idx" ON "document_comments"("documentId", "createdAt");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_blocks" ADD CONSTRAINT "document_blocks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "document_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
