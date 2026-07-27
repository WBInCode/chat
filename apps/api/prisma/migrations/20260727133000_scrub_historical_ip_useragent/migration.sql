-- One-off scrub of personal data captured BEFORE minimization was introduced.
--
-- Minimizing only new writes would have left the existing rows as a full
-- history of addresses and device fingerprints, which is exactly the data we
-- decided not to hold. This backfills the same reduction over what is
-- already stored:
--   IPv4        -> last octet zeroed        (203.0.113.57 -> 203.0.113.0)
--   IPv6        -> truncated to a /48
--   User-Agent  -> "Browser · OS" only
--
-- Safe with respect to the tamper-evident audit chain: the hash covers
-- {orgId, actorId, action, meta, createdAt, prevHash} and deliberately NOT
-- the ip column, so rewriting ip cannot invalidate any existing hash.

-- ── IPv4: zero the final octet ───────────────────────────────────────────
UPDATE "sessions"
SET "ip" = regexp_replace("ip", '^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$', '\1.0')
WHERE "ip" ~ '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$';

UPDATE "audit_logs"
SET "ip" = regexp_replace("ip", '^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$', '\1.0')
WHERE "ip" ~ '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$';

-- IPv4-mapped IPv6 (::ffff:a.b.c.d) is stored as the truncated IPv4.
UPDATE "sessions"
SET "ip" = regexp_replace("ip", '^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$', '\1.0', 'i')
WHERE "ip" ~* '^::ffff:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$';

UPDATE "audit_logs"
SET "ip" = regexp_replace("ip", '^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$', '\1.0', 'i')
WHERE "ip" ~* '^::ffff:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$';

-- ── IPv6: keep the first three groups (a /48), drop the interface part ───
UPDATE "sessions"
SET "ip" = regexp_replace("ip", '^([0-9a-fA-F]+:[0-9a-fA-F]+:[0-9a-fA-F]+):.*$', '\1::')
WHERE "ip" LIKE '%:%'
  AND "ip" !~ '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$'
  AND "ip" ~ '^[0-9a-fA-F]+:[0-9a-fA-F]+:[0-9a-fA-F]+:';

UPDATE "audit_logs"
SET "ip" = regexp_replace("ip", '^([0-9a-fA-F]+:[0-9a-fA-F]+:[0-9a-fA-F]+):.*$', '\1::')
WHERE "ip" LIKE '%:%'
  AND "ip" !~ '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$'
  AND "ip" ~ '^[0-9a-fA-F]+:[0-9a-fA-F]+:[0-9a-fA-F]+:';

-- Anything left in an unrecognised shape is dropped rather than kept.
UPDATE "sessions"
SET "ip" = NULL
WHERE "ip" IS NOT NULL
  AND "ip" !~ '^\d{1,3}\.\d{1,3}\.\d{1,3}\.0$'
  AND "ip" NOT LIKE '%::';

UPDATE "audit_logs"
SET "ip" = NULL
WHERE "ip" IS NOT NULL
  AND "ip" !~ '^\d{1,3}\.\d{1,3}\.\d{1,3}\.0$'
  AND "ip" NOT LIKE '%::';

-- ── User-Agent: reduce to "Browser · OS" ─────────────────────────────────
UPDATE "sessions"
SET "userAgent" =
  (CASE
     WHEN "userAgent" LIKE '%Edg/%'                        THEN 'Edge'
     WHEN "userAgent" LIKE '%OPR/%'
       OR "userAgent" LIKE '%Opera%'                       THEN 'Opera'
     WHEN "userAgent" LIKE '%Firefox/%'                    THEN 'Firefox'
     WHEN "userAgent" LIKE '%Chrome/%'                     THEN 'Chrome'
     WHEN "userAgent" LIKE '%Safari/%'                     THEN 'Safari'
     ELSE 'Przeglądarka'
   END)
  ||
  (CASE
     WHEN "userAgent" LIKE '%Windows%'                     THEN ' · Windows'
     WHEN "userAgent" LIKE '%Android%'                     THEN ' · Android'
     WHEN "userAgent" LIKE '%iPhone%'
       OR "userAgent" LIKE '%iPad%'
       OR "userAgent" LIKE '%iOS%'                         THEN ' · iOS'
     WHEN "userAgent" LIKE '%Mac OS X%'
       OR "userAgent" LIKE '%Macintosh%'                   THEN ' · macOS'
     WHEN "userAgent" LIKE '%Linux%'                       THEN ' · Linux'
     ELSE ''
   END)
WHERE "userAgent" IS NOT NULL
  -- Only touch raw UA strings; already-reduced labels contain no '/' or '('.
  AND ("userAgent" LIKE '%/%' OR "userAgent" LIKE '%(%');
