-- Stores X/Twitter public posts matched to civic complaints.
CREATE TABLE IF NOT EXISTS complaint_social_signals (
  id BIGSERIAL PRIMARY KEY,
  complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'x',
  post_id TEXT NOT NULL,
  post_url TEXT NOT NULL,
  author_handle TEXT,
  text_excerpt TEXT,
  image_url TEXT,
  posted_at TIMESTAMPTZ,
  match_score NUMERIC(5,4) DEFAULT 0,
  text_score NUMERIC(5,4) DEFAULT 0,
  location_score NUMERIC(5,4) DEFAULT 0,
  recency_score NUMERIC(5,4) DEFAULT 0,
  engagement_score NUMERIC(5,4) DEFAULT 0,
  classification_verified BOOLEAN DEFAULT FALSE,
  correlation_status TEXT,
  roboflow_class TEXT,
  roboflow_confidence NUMERIC(5,4) DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  repost_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  query_used TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (complaint_id, platform, post_id)
);

CREATE INDEX IF NOT EXISTS idx_social_signals_complaint_id
  ON complaint_social_signals(complaint_id);

CREATE INDEX IF NOT EXISTS idx_social_signals_match_score
  ON complaint_social_signals(match_score DESC);
