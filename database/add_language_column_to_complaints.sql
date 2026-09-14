-- Records which language a complaint's description was captured in (typed
-- or spoken via the multilingual speech-to-text flow), so admin tooling and
-- future analysis can see it alongside the content.
--
-- Run this manually in the Supabase SQL editor for your project - same
-- ad-hoc pattern as the other files in this database/ folder (complaints
-- was created directly in the Supabase dashboard, not via tracked
-- migrations).
--
-- Backing feature: services/stt/SttProviderService.js (multilingual
-- speech-to-text) + routes/complaints.js. Until this is run,
-- services/schemaAvailability.js's languageColumnAvailable() returns false
-- and the 'language' field is simply dropped before insertion by
-- filterComplaintDataForInsertion() (routes/complaints.js) rather than
-- erroring.

ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';
