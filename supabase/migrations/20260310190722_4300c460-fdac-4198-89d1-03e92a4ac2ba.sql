-- Migration logs table
CREATE TABLE public.migration_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    sql_content text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    result text,
    error_message text,
    execution_time_ms integer,
    created_at timestamptz DEFAULT now() NOT NULL,
    file_name text
);

ALTER TABLE public.migration_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can access migration logs
CREATE POLICY "Admins can manage migration logs"
ON public.migration_logs FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));