ALTER TABLE public.lora_training_jobs ALTER COLUMN dataset_size SET DEFAULT 0;
ALTER TABLE public.lora_training_jobs ADD CONSTRAINT lora_training_jobs_user_job_unique UNIQUE (user_id, job_name);