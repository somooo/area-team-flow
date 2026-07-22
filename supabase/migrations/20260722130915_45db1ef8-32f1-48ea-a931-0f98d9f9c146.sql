
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'team_leader';

UPDATE public.staff SET area = 'Wards' WHERE area = 'Cardiac';
UPDATE public.shifts SET area = 'Wards' WHERE area = 'Cardiac';
UPDATE public.leave_requests SET area = 'Wards' WHERE area = 'Cardiac';
UPDATE public.schedule_change_requests SET area = 'Wards' WHERE area = 'Cardiac';

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS badge_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS password_hash text;

GRANT SELECT ON public.shifts TO anon;
GRANT SELECT ON public.staff TO anon;

DROP POLICY IF EXISTS "Guests can view shifts" ON public.shifts;
CREATE POLICY "Guests can view shifts" ON public.shifts
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Guests can view staff roster" ON public.staff;
CREATE POLICY "Guests can view staff roster" ON public.staff
  FOR SELECT TO anon USING (true);

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS auto_approve_at timestamptz;
ALTER TABLE public.schedule_change_requests
  ADD COLUMN IF NOT EXISTS auto_approve_at timestamptz;

CREATE TABLE IF NOT EXISTS public.preschedule_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_email text NOT NULL,
  requester_name text NOT NULL,
  area text NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('off','switch')),
  target_month date NOT NULL,
  requested_dates date[] NOT NULL DEFAULT '{}',
  swap_with_email text,
  swap_with_name text,
  details text,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  approver_email text,
  auto_approve_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.preschedule_requests TO authenticated;
GRANT ALL ON public.preschedule_requests TO service_role;

ALTER TABLE public.preschedule_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Requester and area supervisors read preschedule"
  ON public.preschedule_requests FOR SELECT TO authenticated
  USING (
    lower(requester_email) = public.current_email()
    OR public.is_admin()
    OR public.is_supervisor_of(area)
    OR (public.my_role()::text = 'team_leader' AND public.my_area() = area)
  );

CREATE POLICY "Users insert own preschedule"
  ON public.preschedule_requests FOR INSERT TO authenticated
  WITH CHECK (lower(requester_email) = public.current_email());

CREATE POLICY "Approvers update preschedule"
  ON public.preschedule_requests FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR public.is_supervisor_of(area)
    OR lower(approver_email) = public.current_email()
  );

CREATE TABLE IF NOT EXISTS public.system_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

GRANT SELECT ON public.system_rules TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.system_rules TO authenticated;
GRANT ALL ON public.system_rules TO service_role;

ALTER TABLE public.system_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read system rules"
  ON public.system_rules FOR SELECT USING (true);

CREATE POLICY "Admins manage system rules"
  ON public.system_rules FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

INSERT INTO public.system_rules (key, value, description) VALUES
  ('vacation_cap_pct', '30'::jsonb, 'Max % of area staff on vacation same day'),
  ('vacation_yearly_days', '25'::jsonb, 'Vacation days per staff per year'),
  ('preschedule_lead_days', '10'::jsonb, 'Days before month start when preschedule window closes'),
  ('auto_approve_days', '3'::jsonb, 'Auto-approve pending requests after this many days'),
  ('ot_monthly_max_hours', '60'::jsonb, 'Max OT hours per staff per month'),
  ('same_day_edit_roles', '["team_leader","supervisor","admin"]'::jsonb, 'Roles allowed to edit same-day SL/OT')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email text,
  actor_role text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  area text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view audit logs"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "Authenticated write audit"
  ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_preschedule_updated ON public.preschedule_requests;
CREATE TRIGGER trg_preschedule_updated BEFORE UPDATE ON public.preschedule_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.staff (name, email, role, area, department)
VALUES
  ('Assistants Supervisor', 'assistants.sup@example.com', 'supervisor', 'Assistants', 'RT Assistants'),
  ('Assistant Aisha', 'aisha.assist@example.com', 'staff', 'Assistants', 'RT Assistants'),
  ('Assistant Ben', 'ben.assist@example.com', 'staff', 'Assistants', 'RT Assistants')
ON CONFLICT (email) DO NOTHING;

UPDATE public.staff
  SET supervisor_email = 'assistants.sup@example.com'
  WHERE area = 'Assistants' AND role = 'staff' AND supervisor_email IS NULL;
