-- Universal bootstrap for primary admin account.
-- Idempotent: safe to run multiple times.

DO $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Ensure required crypto funcs exist for password hashing.
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  -- 1) Create user if missing, otherwise reset password and confirm email.
  SELECT id
  INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower('jj1212t@gmail.com')
  LIMIT 1;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      confirmation_token,
      recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      'jj1212t@gmail.com',
      crypt('543211', gen_salt('bf')),
      now(),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"jj1212t"}'::jsonb,
      false,
      '',
      ''
    );
  ELSE
    UPDATE auth.users
    SET encrypted_password = crypt('543211', gen_salt('bf')),
        email_confirmed_at = now(),
        confirmation_token = '',
        recovery_token = '',
        updated_at = now()
    WHERE id = v_user_id;
  END IF;

  -- 2) Ensure profile exists and is synchronized.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
  ) THEN
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (v_user_id, 'jj1212t@gmail.com', 'jj1212t')
    ON CONFLICT (id)
    DO UPDATE SET email = EXCLUDED.email,
                  full_name = EXCLUDED.full_name,
                  updated_at = now();
  END IF;

  -- 3) Ensure admin role exists for this user.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user_roles'
  ) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_user_id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RAISE NOTICE 'Primary admin ready: jj1212t@gmail.com (id=%)', v_user_id;
END
$$;

-- Keep admin assignment resilient for future insert/email updates.
CREATE OR REPLACE FUNCTION public.is_primary_admin_email(_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT lower(coalesce(_email, '')) = lower('jj1212t@gmail.com')
$$;

CREATE OR REPLACE FUNCTION public.handle_admin_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_primary_admin_email(NEW.email) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_admin ON auth.users;
CREATE TRIGGER on_auth_user_created_admin
AFTER INSERT OR UPDATE OF email ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_admin_assignment();