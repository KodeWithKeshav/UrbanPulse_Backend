-- Adds per-device duplicate-vote protection for guest (unauthenticated)
-- votes.
--
-- Run this manually in the Supabase SQL editor for your project - same
-- ad-hoc pattern as the other files in this database/ folder (complaints
-- and complaint_votes were both created directly in the Supabase
-- dashboard, not via tracked migrations).
--
-- Backing feature: services/voteService.js + routes/guest-votes.js. Until
-- this is run, services/schemaAvailability.js's deviceIdColumnAvailable()
-- returns false and guest votes fall back to today's behavior (no
-- duplicate-vote protection, user_id stored as NULL) rather than erroring.

ALTER TABLE complaint_votes
  ADD COLUMN IF NOT EXISTS device_id TEXT;

CREATE INDEX IF NOT EXISTS idx_complaint_votes_device_id ON complaint_votes(device_id);

-- Prevents the same device from voting twice on the same complaint at the
-- database level, not just in application code (defense in depth against
-- e.g. two rapid concurrent requests both seeing "no existing vote").
-- Partial index (device_id IS NOT NULL) so authenticated votes, which
-- leave device_id null, are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_complaint_votes_unique_device_per_complaint
  ON complaint_votes(complaint_id, device_id)
  WHERE device_id IS NOT NULL;

-- Same defense-in-depth for authenticated votes (services/voteService.js
-- already checks for an existing vote in application code, but two
-- concurrent requests from the same user could both pass that check before
-- either insert commits - this makes the database itself the final guard).
--
-- Cleanup first: the pre-fix vote handlers (see routes/complaints.js,
-- routes/guest-votes.js history) could already have inserted duplicate
-- (complaint_id, user_id) rows, which would make the CREATE UNIQUE INDEX
-- below fail outright. Keep only the newest row per pair; safe to run even
-- if there are no duplicates.
DELETE FROM complaint_votes a
USING complaint_votes b
WHERE a.user_id IS NOT NULL
  AND a.user_id = b.user_id
  AND a.complaint_id = b.complaint_id
  AND (
    COALESCE(a.created_at, '-infinity'::timestamptz) < COALESCE(b.created_at, '-infinity'::timestamptz)
    OR (
      COALESCE(a.created_at, '-infinity'::timestamptz) = COALESCE(b.created_at, '-infinity'::timestamptz)
      AND a.id < b.id
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_complaint_votes_unique_user_per_complaint
  ON complaint_votes(complaint_id, user_id)
  WHERE user_id IS NOT NULL;
