ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS ab_compare_cart_json JSONB;