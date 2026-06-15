-- Add UI view preferences columns for cloud persistence
-- Dashboard view mode, folder manager view/sort, player layout, tab settings
ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS dashboard_view_mode TEXT DEFAULT 'cards',
ADD COLUMN IF NOT EXISTS folder_view_mode TEXT DEFAULT 'cards',
ADD COLUMN IF NOT EXISTS folder_sort_key TEXT DEFAULT 'date',
ADD COLUMN IF NOT EXISTS folder_sort_asc BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS player_layout TEXT DEFAULT 'split',
ADD COLUMN IF NOT EXISTS tab_settings_json JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS default_ai_model TEXT DEFAULT NULL;
