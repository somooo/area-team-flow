-- 1. Derivation helper: a vacation's area always comes from the staff directory
CREATE OR REPLACE FUNCTION public.derive_leave_area(_staff_id uuid, _staff_email text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s record;
BEGIN
  SELECT id, role, area, status INTO s
    FROM public.staff
   WHERE (_staff_id IS NOT NULL AND id = _staff_id)
      OR (_staff_id IS NULL AND lower(email) = lower(coalesce(_staff_email, '')))
   LIMIT 1;

  IF s.id IS NULL THEN RETURN 'Unassigned'; END IF;
  IF s.role = 'supervisor' THEN RETURN 'Supervisors'; END IF;
  IF coalesce(s.status, 'Active') <> 'Active' THEN RETURN 'Unassigned'; END IF;
  IF s.area IS NULL OR btrim(s.area) = '' THEN RETURN 'Unassigned'; END IF;
  RETURN s.area;
END $$;

REVOKE EXECUTE ON FUNCTION public.derive_leave_area(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.derive_leave_area(uuid, text) TO authenticated, service_role;

-- 2. Cap trigger must be skippable for system-driven area moves
CREATE OR REPLACE FUNCTION public.enforce_vacation_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cap_area text;
  cap_pct int;
  headcount int;
  cap int;
  counts_pending boolean;
  blocked text[];
  caller_role text := current_setting('request.jwt.claims', true)::jsonb->>'role';
  may_override boolean;
BEGIN
  IF coalesce(current_setting('app.skip_vacation_cap', true), '') = 'on' THEN RETURN NEW; END IF;
  IF NEW.leave_type <> 'Vacation' THEN RETURN NEW; END IF;
  IF NEW.status = 'Rejected' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.start_date = NEW.start_date
     AND OLD.end_date = NEW.end_date
     AND OLD.area = NEW.area
     AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  cap_area := CASE WHEN NEW.area = 'Supervisors' THEN 'Supervisor' ELSE NEW.area END;
  SELECT c.cap_pct INTO cap_pct FROM public.vacation_caps c WHERE c.area = cap_area;
  IF cap_pct IS NULL THEN RETURN NEW; END IF;

  IF NEW.area = 'Supervisors' THEN
    SELECT count(*) INTO headcount FROM public.staff WHERE role = 'supervisor';
  ELSE
    SELECT count(*) INTO headcount FROM public.staff WHERE area = NEW.area;
  END IF;

  cap := greatest(1, floor(headcount * cap_pct / 100.0)::int);

  SELECT coalesce((value)::text <> 'false', true) INTO counts_pending
    FROM public.system_rules WHERE key = 'vacation_cap_counts_pending';
  counts_pending := coalesce(counts_pending, true);

  SELECT array_agg(to_char(g::date, 'YYYY-MM-DD') ORDER BY g)
    INTO blocked
    FROM generate_series(NEW.start_date::timestamp, NEW.end_date::timestamp, interval '1 day') g
   WHERE (
     SELECT count(*) FROM public.leave_requests l
      WHERE l.leave_type = 'Vacation'
        AND l.area = NEW.area
        AND l.id IS DISTINCT FROM NEW.id
        AND (l.status = 'Approved' OR (counts_pending AND l.status = 'Pending'))
        AND l.start_date <= g::date AND l.end_date >= g::date
   ) >= cap;

  IF blocked IS NULL OR array_length(blocked, 1) = 0 THEN
    IF TG_OP = 'INSERT' OR NOT NEW.over_cap_override THEN
      NEW.over_cap_override := false;
      NEW.over_cap_reason := NULL;
      NEW.over_cap_by := NULL;
    END IF;
    RETURN NEW;
  END IF;

  may_override := caller_role = 'service_role'
    OR public.is_admin()
    OR public.is_area_manager_of(NEW.area);

  IF NEW.over_cap_override AND may_override
     AND NEW.over_cap_reason IS NOT NULL AND length(btrim(NEW.over_cap_reason)) > 0 THEN
    NEW.over_cap_by := coalesce(nullif(public.current_email(), ''), NEW.over_cap_by);
    RETURN NEW;
  END IF;

  IF NEW.over_cap_override AND NOT may_override THEN
    RAISE EXCEPTION 'Only admins or area managers may override the vacation cap';
  END IF;
  IF NEW.over_cap_override THEN
    RAISE EXCEPTION 'An override reason is required to exceed the vacation cap';
  END IF;

  RAISE EXCEPTION 'Blocked: % are at capacity.', array_to_string(blocked, ', ');
END $function$;

-- 3. Always stamp the derived area (and staff_id) on write; the client value is ignored
CREATE OR REPLACE FUNCTION public.leave_area_from_staff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.staff_id IS NULL THEN
    SELECT id INTO NEW.staff_id FROM public.staff
     WHERE lower(email) = lower(coalesce(NEW.staff_email, '')) LIMIT 1;
  END IF;
  NEW.area := public.derive_leave_area(NEW.staff_id, NEW.staff_email);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_a_leave_area_from_staff ON public.leave_requests;
CREATE TRIGGER trg_a_leave_area_from_staff
BEFORE INSERT OR UPDATE ON public.leave_requests
FOR EACH ROW EXECUTE FUNCTION public.leave_area_from_staff();

ALTER TABLE public.leave_requests ALTER COLUMN area SET DEFAULT 'Unassigned';

-- 4. Directory area/role/status changes cascade to that staff member's vacations
CREATE OR REPLACE FUNCTION public.staff_area_cascade_leaves()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.area IS NOT DISTINCT FROM OLD.area
     AND NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND lower(NEW.email) = lower(OLD.email) THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.skip_vacation_cap', 'on', true);
  UPDATE public.leave_requests l
     SET area = public.derive_leave_area(NEW.id, NEW.email)
   WHERE (l.staff_id = NEW.id OR lower(l.staff_email) = lower(NEW.email))
     AND l.area IS DISTINCT FROM public.derive_leave_area(NEW.id, NEW.email);
  PERFORM set_config('app.skip_vacation_cap', 'off', true);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_staff_area_cascade_leaves ON public.staff;
CREATE TRIGGER trg_staff_area_cascade_leaves
AFTER UPDATE ON public.staff
FOR EACH ROW EXECUTE FUNCTION public.staff_area_cascade_leaves();

-- 5. Migrate existing vacation records to their staff member's current area
DO $$
DECLARE changed int;
BEGIN
  PERFORM set_config('app.skip_vacation_cap', 'on', true);
  WITH upd AS (
    UPDATE public.leave_requests l
       SET area = public.derive_leave_area(l.staff_id, l.staff_email)
     WHERE l.area IS DISTINCT FROM public.derive_leave_area(l.staff_id, l.staff_email)
    RETURNING 1
  )
  SELECT count(*) INTO changed FROM upd;
  RAISE NOTICE 'leave_requests area migrated: % rows', changed;
  PERFORM set_config('app.skip_vacation_cap', 'off', true);
END $$;

-- 6. Unassigned bucket needs a caps row so the calendar can render it
INSERT INTO public.vacation_caps (area, cap_pct, warn_pct)
VALUES ('Unassigned', 100, 100)
ON CONFLICT (area) DO NOTHING;