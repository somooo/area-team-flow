CREATE OR REPLACE FUNCTION public.vacation_change_deadline(_start_date date)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT (date_trunc('month', _start_date)::date - interval '1 month')::date
         + (LEAST(GREATEST(COALESCE((SELECT (value #>> '{}')::int FROM public.system_rules WHERE key = 'vacation_change_deadline_day'), 15), 1), 28) - 1)
$$;

CREATE OR REPLACE FUNCTION public.enforce_change_request_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  caller_role text := current_setting('request.jwt.claims', true)::jsonb->>'role';
  s_role app_role;
  v_start date;
  dl date;
BEGIN
  IF caller_role = 'service_role' THEN RETURN NEW; END IF;
  s_role := public.my_role();
  IF public.is_admin() OR s_role IN ('supervisor','team_leader') THEN RETURN NEW; END IF;

  SELECT start_date INTO v_start FROM public.leave_requests WHERE id = NEW.leave_request_id;
  IF v_start IS NULL THEN RETURN NEW; END IF;

  dl := public.vacation_change_deadline(v_start);
  IF current_date > dl THEN
    RAISE EXCEPTION 'The deadline to change % leave was %. Contact your supervisor.',
      to_char(v_start, 'FMMonth'), to_char(dl, 'DD Mon YYYY');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_change_request_deadline ON public.vacation_change_requests;
CREATE TRIGGER trg_enforce_change_request_deadline
BEFORE INSERT ON public.vacation_change_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_change_request_deadline();

GRANT EXECUTE ON FUNCTION public.vacation_change_deadline(date) TO authenticated;