-- Apply this if complaint_social_signals table already exists.
ALTER TABLE complaint_social_signals
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS classification_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS correlation_status TEXT,
  ADD COLUMN IF NOT EXISTS roboflow_class TEXT,
  ADD COLUMN IF NOT EXISTS roboflow_confidence NUMERIC(5,4) DEFAULT 0;
