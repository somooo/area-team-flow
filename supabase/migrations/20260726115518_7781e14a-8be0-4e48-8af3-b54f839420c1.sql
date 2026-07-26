-- 1) Cross-area read access for shifts
DROP POLICY IF EXISTS "read shifts area or admin" ON public.shifts;
CREATE POLICY "authenticated read all shifts" ON public.shifts
  FOR SELECT TO authenticated USING (true);

-- 2) Cross-area read access for staff, minus secret columns
DROP POLICY IF EXISTS "read own area or admin" ON public.staff;
CREATE POLICY "authenticated read all staff" ON public.staff
  FOR SELECT TO authenticated USING (true);

REVOKE SELECT ON public.staff FROM authenticated;
GRANT SELECT (id, name, email, role, area, department, supervisor_email, delegated_to_email, delegation_active, created_at)
  ON public.staff TO authenticated;
GRANT ALL ON public.staff TO service_role;

-- 3) Missed OT preschedule category
ALTER TABLE public.preschedule_requests DROP CONSTRAINT IF EXISTS preschedule_requests_request_type_check;
ALTER TABLE public.preschedule_requests
  ADD CONSTRAINT preschedule_requests_request_type_check
  CHECK (request_type IN ('off','switch','missed_ot'));

ALTER TABLE public.preschedule_requests
  ADD COLUMN IF NOT EXISTS missed_ot_date date,
  ADD COLUMN IF NOT EXISTS unit_code text,
  ADD COLUMN IF NOT EXISTS contacted_by text;

-- 4) Preschedule window rules
DELETE FROM public.system_rules WHERE key = 'preschedule_lead_days';
INSERT INTO public.system_rules (key, value, description)
VALUES
  ('preschedule_open_day', '10'::jsonb, 'Day of month the pre-schedule window opens'),
  ('preschedule_close_day', '20'::jsonb, 'Day of month the pre-schedule window closes')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;