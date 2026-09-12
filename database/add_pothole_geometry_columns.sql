-- Adds pothole footprint/depth estimation fields to complaints.
--
-- Run this manually in the Supabase SQL editor for your project. This repo
-- has no tracked migration tooling for the `complaints` table -- it was
-- created directly in the Supabase dashboard and its schema is discovered
-- at runtime by routes/complaints.js (checkComplaintsTableSchema()). See
-- the other files in this database/ folder for the same ad-hoc pattern.
--
-- Backing feature: services/potholeGeometryService.js +
-- services/potholeGeometryMath.js ("Pothole Footprint & Depth Estimation").

ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS estimated_width_cm   NUMERIC(6,1),
  ADD COLUMN IF NOT EXISTS estimated_length_cm  NUMERIC(6,1),
  ADD COLUMN IF NOT EXISTS estimated_area_cm2   NUMERIC(9,1),
  ADD COLUMN IF NOT EXISTS estimated_depth_cm   NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS geometry_confidence  NUMERIC(3,2),  -- 0.00-1.00
  ADD COLUMN IF NOT EXISTS geometry_method      TEXT,
  ADD COLUMN IF NOT EXISTS geometry_assumptions JSONB,
  ADD COLUMN IF NOT EXISTS geometry_status      TEXT DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS geometry_error       TEXT,
  ADD COLUMN IF NOT EXISTS geometry_computed_at TIMESTAMPTZ;

-- Apply this if the constraint doesn't already exist (re-running the ALTER
-- TABLE above is safe via IF NOT EXISTS, but constraints need their own guard).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'complaints_geometry_status_check'
  ) THEN
    ALTER TABLE complaints
      ADD CONSTRAINT complaints_geometry_status_check
      CHECK (geometry_status IN ('pending', 'completed', 'failed', 'not_applicable'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_complaints_geometry_status ON complaints(geometry_status);
