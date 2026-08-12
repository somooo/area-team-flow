DROP POLICY IF EXISTS "read shifts in own area" ON public.shifts;
CREATE POLICY "authenticated read all shifts"
  ON public.shifts FOR SELECT TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.enforce_change_request_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  caller_role text := current_setting('request.jwt.claims', true)::jsonb->>'role';
  s_role app_role;
  me_email text := public.current_email();
  src record;
BEGIN
  IF caller_role = 'service_role' THEN RETURN NEW; END IF;
  s_role := public.my_role();
  IF public.is_admin() OR s_role IN ('supervisor','team_leader') THEN RETURN NEW; END IF;

  IF lower(coalesce(NEW.requester_email, '')) <> me_email THEN
    RAISE EXCEPTION 'You can only raise change requests for yourself';
  END IF;

  SELECT staff_email, staff_id INTO src FROM public.shifts WHERE id = NEW.source_shift_id;
  IF src IS NULL THEN RAISE EXCEPTION 'Shift not found'; END IF;
  IF lower(coalesce(src.staff_email, '')) <> me_email THEN
    RAISE EXCEPTION 'You can only request changes on your own assignments';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_change_request_ownership ON public.schedule_change_requests;
CREATE TRIGGER trg_enforce_change_request_ownership
  BEFORE INSERT OR UPDATE OF source_shift_id, requester_email ON public.schedule_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_change_request_ownership();