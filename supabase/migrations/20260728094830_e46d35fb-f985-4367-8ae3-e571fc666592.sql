ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS covering_supervisor_email text,
  ADD COLUMN IF NOT EXISTS stage text;

-- Shared "Supervisors" calendar visibility / management
CREATE POLICY "supervisors read supervisors calendar"
ON public.leave_requests FOR SELECT TO authenticated
USING (area = 'Supervisors' AND (public.is_admin() OR public.my_role() IN ('supervisor','team_leader')));

CREATE POLICY "covering or admin update supervisors calendar"
ON public.leave_requests FOR UPDATE TO authenticated
USING (
  public.is_admin()
  OR lower(coalesce(covering_supervisor_email,'')) = public.current_email()
)
WITH CHECK (
  public.is_admin()
  OR lower(coalesce(covering_supervisor_email,'')) = public.current_email()
);

-- Keep shifts in sync when an approved vacation's dates are edited
CREATE OR REPLACE FUNCTION public.sync_leave_to_shifts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  ds date[];
BEGIN
  IF NEW.status = 'Approved' AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM 'Approved'
       OR OLD.start_date IS DISTINCT FROM NEW.start_date
       OR OLD.end_date IS DISTINCT FROM NEW.end_date
     ) THEN
    IF TG_OP = 'UPDATE' AND OLD.status = 'Approved' THEN
      PERFORM public.revert_request_shifts('leave', NEW.id);
    END IF;
    SELECT array_agg(g::date) INTO ds
      FROM generate_series(NEW.start_date::timestamp, NEW.end_date::timestamp, interval '1 day') g;
    PERFORM public.apply_absence_to_shifts(
      NEW.staff_email, NEW.staff_name, NEW.area, ds,
      (CASE WHEN NEW.leave_type = 'Vacation' THEN 'Vacation' ELSE 'Sick' END)::duty_type,
      'leave', NEW.id);
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Approved' AND NEW.status IS DISTINCT FROM 'Approved' THEN
    PERFORM public.revert_request_shifts('leave', NEW.id);
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_sync_leave_to_shifts ON public.leave_requests;
CREATE TRIGGER trg_sync_leave_to_shifts
AFTER INSERT OR UPDATE OF status, start_date, end_date ON public.leave_requests
FOR EACH ROW EXECUTE FUNCTION public.sync_leave_to_shifts();