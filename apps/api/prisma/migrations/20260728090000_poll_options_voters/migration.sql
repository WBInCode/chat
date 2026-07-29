-- Poll upgrade (F4-E follow-up): hidden voter identities, manual close and
-- per-option emoji. All columns are additive with safe defaults, so existing
-- polls keep their current behaviour (named, open-ended, no emoji).

-- AlterTable
ALTER TABLE "polls" ADD COLUMN "hideVoters" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "polls" ADD COLUMN "closedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "poll_options" ADD COLUMN "emoji" TEXT;

-- CreateIndex
-- Supports "all votes cast by this user in this poll" (single-choice replace)
-- and the voter lookup, which previously fell back to a sequential scan.
CREATE INDEX "poll_votes_userId_idx" ON "poll_votes"("userId");
