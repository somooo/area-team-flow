-- 1. Staff Directory view: admin only
CREATE OR REPLACE VIEW public.staff_directory
WITH (security_invoker = off) AS
  SELECT id, name, first_name, last_name, "position", badge_id, date_of_hire,
         email, assigned_to, status, supervisor, supervisor_email, extension,
         notes, area, role, custom_fields
    FROM public.staff
   WHERE public.my_role() = 'admin'::app_role;

-- 2. Only admins may create or delete staff records
DROP POLICY IF EXISTS "area mgr inserts staff" ON public.staff;
DROP POLICY IF EXISTS "area mgr deletes staff" ON public.staff;

CREATE POLICY "admins insert staff" ON public.staff
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "admins delete staff" ON public.staff
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- 3. Supervisors may only re-assign the schedule area of staff in their scope
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

  -- Own record: may update contact-ish fields, never role/area/supervisor
  IF lower(NEW.email) = caller_email THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.area IS DISTINCT FROM OLD.area
       OR NEW.supervisor_email IS DISTINCT FROM OLD.supervisor_email
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.badge_id IS DISTINCT FROM OLD.badge_id
       OR NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
      RAISE EXCEPTION 'Users cannot change role/area/supervisor/identity on own record';
    END IF;
    RETURN NEW;
  END IF;

  -- Someone else's record: supervisors may ONLY move them in/out of a schedule area
  IF NEW.name IS DISTINCT FROM OLD.name
     OR NEW.first_name IS DISTINCT FROM OLD.first_name
     OR NEW.last_name IS DISTINCT FROM OLD.last_name
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.badge_id IS DISTINCT FROM OLD.badge_id
     OR NEW.password_hash IS DISTINCT FROM OLD.password_hash
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