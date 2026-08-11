-- 1) vacation_caps
CREATE TABLE public.vacation_caps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area text NOT NULL UNIQUE,
  cap_pct integer NOT NULL DEFAULT 12,
  warn_pct integer NOT NULL DEFAULT 80,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
GRANT SELECT, UPDATE ON public.vacation_caps TO authenticated;
GRANT ALL ON public.vacation_caps TO service_role;
ALTER TABLE public.vacation_caps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read caps" ON public.vacation_caps FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins update caps" ON public.vacation_caps FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE TRIGGER trg_vacation_caps_updated BEFORE UPDATE ON public.vacation_caps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
INSERT INTO public.vacation_caps (area) VALUES ('Supervisor'), ('Wards'), ('ICU'), ('Assistants');

-- 2) vacation_change_requests
CREATE TABLE public.vacation_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request_id uuid NOT NULL REFERENCES public.leave_requests(id) ON DELETE CASCADE,
  requested_by text NOT NULL,
  type text NOT NULL CHECK (type IN ('cancel','adjust')),
  new_start_date date,
  new_end_date date,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_vcr_leave ON public.vacation_change_requests(leave_request_id);
GRANT SELECT, INSERT, UPDATE ON public.vacation_change_requests TO authenticated;
GRANT ALL ON public.vacation_change_requests TO service_role;
ALTER TABLE public.vacation_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "insert own change request" ON public.vacation_change_requests FOR INSERT TO authenticated
  WITH CHECK (lower(requested_by) = public.current_email());
CREATE POLICY "read own or manager" ON public.vacation_change_requests FOR SELECT TO authenticated
  USING (lower(requested_by) = public.current_email() OR public.is_admin() OR public.my_role() IN ('supervisor','team_leader'));
CREATE POLICY "managers decide change requests" ON public.vacation_change_requests FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.my_role() IN ('supervisor','team_leader'))
  WITH CHECK (public.is_admin() OR public.my_role() IN ('supervisor','team_leader'));

-- 3) settings keys
INSERT INTO public.system_rules (key, value, description, type, "group") VALUES
  ('vacation_change_deadline_day', '15'::jsonb, 'Day of month after which vacation change requests are closed', 'number', 'Vacation'),
  ('vacation_cap_counts_pending', 'true'::jsonb, 'Count pending vacation requests toward the area cap', 'boolean', 'Vacation')
ON CONFLICT (key) DO NOTHING;

-- 4) leave_requests insert policy hardening (RLS stays enabled)
CREATE POLICY "insert own leave by staff id" ON public.leave_requests FOR INSERT TO authenticated
  WITH CHECK (
    lower(staff_email) = public.current_email()
    OR staff_id = (SELECT s.id FROM public.staff s WHERE lower(s.email) = public.current_email() LIMIT 1)
    OR (area = 'Supervisors' AND (public.is_admin() OR public.my_role() IN ('supervisor','team_leader')))
  );