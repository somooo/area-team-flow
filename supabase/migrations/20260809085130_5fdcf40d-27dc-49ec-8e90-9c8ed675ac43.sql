-- 1) Split password_hash into a protected table
CREATE TABLE IF NOT EXISTS public.staff_secrets (
  staff_id uuid PRIMARY KEY REFERENCES public.staff(id) ON DELETE CASCADE,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.staff_secrets TO service_role;
ALTER TABLE public.staff_secrets ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (which bypasses RLS) may access.

INSERT INTO public.staff_secrets (staff_id, password_hash)
SELECT id, password_hash FROM public.staff WHERE password_hash IS NOT NULL
ON CONFLICT (staff_id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_staff_secrets_updated ON public.staff_secrets;
CREATE TRIGGER trg_staff_secrets_updated BEFORE UPDATE ON public.staff_secrets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- staff_guard_privileges references NEW.password_hash; update before dropping the column
CREATE OR REPLACE FUNCTION public.staff_guard_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller_email text := public.current_email();
  caller_is_admin boolean := public.is_admin();
  caller_role text := current_setting('request.jwt.claims', true)::jsonb->>'role';
BEGIN
  IF caller_role = 'service_role' THEN RETURN NEW; END IF;
  IF caller_is_admin THEN RETURN NEW; END IF;

  IF lower(NEW.email) = caller_email THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.area IS DISTINCT FROM OLD.area
       OR NEW.supervisor_email IS DISTINCT FROM OLD.supervisor_email
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.badge_id IS DISTINCT FROM OLD.badge_id THEN
      RAISE EXCEPTION 'Users cannot change role/area/supervisor/identity on own record';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.name IS DISTINCT FROM OLD.name
     OR NEW.first_name IS DISTINCT FROM OLD.first_name
     OR NEW.last_name IS DISTINCT FROM OLD.last_name
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.badge_id IS DISTINCT FROM OLD.badge_id
     OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     OR NEW."position" IS DISTINCT FROM OLD."position"
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.date_of_hire IS DISTINCT FROM OLD.date_of_hire
     OR NEW.extension IS DISTINCT FROM OLD.extension
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.custom_fields IS DISTINCT FROM OLD.custom_fields
     OR NEW.supervisor IS DISTINCT FROM OLD.supervisor THEN
    RAISE EXCEPTION 'Supervisors may only assign or unassign a schedule area';
  END IF;

  RETURN NEW;
END $function$;

ALTER TABLE public.staff DROP COLUMN IF EXISTS password_hash;

-- 2) Drop the SECURITY DEFINER view
DROP VIEW IF EXISTS public.staff_directory;

-- 3) Audit logs: forbid forged actor identity
DROP POLICY IF EXISTS "Authenticated write audit" ON public.audit_logs;
CREATE POLICY "Authenticated write audit own identity"
ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (
  actor_email IS NULL OR lower(actor_email) = public.current_email()
);

-- 4) Badge sign-in attempts: admins may review
CREATE POLICY "Admins read badge signin attempts"
ON public.badge_signin_attempts FOR SELECT TO authenticated
USING (public.is_admin());
GRANT SELECT ON public.badge_signin_attempts TO authenticated;
GRANT ALL ON public.badge_signin_attempts TO service_role;

-- 5) Internal SECURITY DEFINER helpers must not be API-callable
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_role() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_area() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_email() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_supervisor_of(text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_area_manager_of(text) FROM anon, authenticated, PUBLIC;