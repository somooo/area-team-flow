ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS import_source text;

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
  s_role app_role;
BEGIN
  IF coalesce(current_setting('app.skip_vacation_cap', true), '') = 'on' THEN RETURN NEW; END IF;
  IF NEW.leave_type <> 'Vacation' THEN RETURN NEW; END IF;
  IF NEW.status IN ('Rejected', 'Cancelled') THEN RETURN NEW; END IF;

  -- Privileged bulk import: caps are request-time rules only and never block an import.
  IF NEW.import_source = 'excel_import' THEN
    s_role := public.my_role();
    IF caller_role = 'service_role' OR public.is_admin() OR s_role IN ('supervisor','team_leader') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only admins or supervisors may import vacations';
  END IF;

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