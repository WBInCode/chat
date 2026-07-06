-- Full-text search on message content.
-- Uses the 'simple' configuration (language-agnostic, good enough for a
-- mixed PL/EN internal chat; avoids requiring a Polish tsearch dictionary).
-- A GIN index over an expression keeps queries fast without a stored column.
CREATE INDEX "messages_content_fts_idx"
  ON "messages"
  USING GIN (to_tsvector('simple', "content"));