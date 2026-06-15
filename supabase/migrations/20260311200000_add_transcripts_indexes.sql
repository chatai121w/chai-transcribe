-- Performance indexes for transcripts table
CREATE INDEX IF NOT EXISTS idx_transcripts_user_id ON transcripts (user_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_user_created ON transcripts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transcripts_folder ON transcripts (folder);
CREATE INDEX IF NOT EXISTS idx_transcripts_category ON transcripts (category);
CREATE INDEX IF NOT EXISTS idx_transcripts_is_favorite ON transcripts (is_favorite);
CREATE INDEX IF NOT EXISTS idx_transcripts_created_at ON transcripts (created_at DESC);
