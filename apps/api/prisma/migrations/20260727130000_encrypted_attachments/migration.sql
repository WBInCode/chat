-- Client-side encrypted attachments for E2E conversations. The server
-- stores an opaque blob: no MIME sniffing, no thumbnailing, no virus scan
-- is possible because the bytes are unreadable to it.

ALTER TABLE "files" ADD COLUMN "encrypted" BOOLEAN NOT NULL DEFAULT false;
