-- Advanced primary-admin migration:
-- 1) Backfills admin role for existing primary-admin email.
-- 2) Keeps admin role auto-assigned on auth.users insert/update.
-- 3) Prevents accidental removal/demotion of the primary-admin role.

-- Backfill: ensure current primary admin has role=admin.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::public.app_role
FROM auth.users u
WHERE lower(u.email) = lower('jj1212t@gmail.com')
ON CONFLICT (user_id, role) DO NOTHING;

-- Centralized helper keeps email logic in one place.
CREATE OR REPLACE FUNCTION public.is_primary_admin_email(_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT lower(coalesce(_email, '')) = lower('jj1212t@gmail.com')
$$;

-- Keep assignment resilient for both new users and email updates.
CREATE OR REPLACE FUNCTION public.handle_admin_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_primary_admin_email(NEW.email) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger so it handles both insert and email updates.
DROP TRIGGER IF EXISTS on_auth_user_created_admin ON auth.users;
CREATE TRIGGER on_auth_user_created_admin
AFTER INSERT OR UPDATE OF email ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_admin_assignment();

-- Guardrail: block accidental removal/demotion of primary admin role.
CREATE OR REPLACE FUNCTION public.protect_primary_admin_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_primary_admin boolean;
BEGIN
  SELECT public.is_primary_admin_email(u.email)
  INTO is_primary_admin
  FROM auth.users u
  WHERE u.id = OLD.user_id;

  IF is_primary_admin AND OLD.role = 'admin'::public.app_role THEN
    RAISE EXCEPTION 'Cannot remove admin role from primary admin account';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS protect_primary_admin_role_trigger ON public.user_roles;
CREATE TRIGGER protect_primary_admin_role_trigger
BEFORE DELETE OR UPDATE OF role ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.protect_primary_admin_role();