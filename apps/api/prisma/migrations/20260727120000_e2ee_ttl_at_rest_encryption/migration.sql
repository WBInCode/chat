-- E2EE for DMs, disappearing messages (per-channel TTL) and org-level
-- at-rest encryption of message content.

ALTER TABLE "organizations" ADD COLUMN "encryptAtRest" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "channels" ADD COLUMN "e2ee" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "channels" ADD COLUMN "messageTtlSeconds" INTEGER;

ALTER TABLE "messages" ADD COLUMN "encrypted" BOOLEAN NOT NULL DEFAULT false;
