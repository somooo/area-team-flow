
-- ============ 1a. Remove anon access ============
REVOKE SELECT ON public.staff, public.shifts FROM anon;
DROP POLICY IF EXISTS "Guests can view shifts" ON public.shifts;
DROP POLICY IF EXISTS "Guests can view staff roster" ON public.staff;

-- ============ 2c. is_area_manager_of + role updates ============
CREATE OR REPLACE FUNCTION public.is_area_manager_of(_area text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff
    WHERE lower(email) = public.current_email()
      AND role IN ('supervisor','team_leader')
      AND area = _area
  )
$$;

-- Rebuild policies that referenced is_supervisor_of
DROP POLICY IF EXISTS "supervisor deletes area staff" ON public.staff;
DROP POLICY IF EXISTS "supervisor manages area staff" ON public.staff;
DROP POLICY IF EXISTS "supervisor updates area staff" ON public.staff;
DROP POLICY IF EXISTS "supervisor delete shifts" ON public.shifts;
DROP POLICY IF EXISTS "supervisor insert shifts" ON public.shifts;
DROP POLICY IF EXISTS "supervisor update shifts" ON public.shifts;
DROP POLICY IF EXISTS "supervisor update leave" ON public.leave_requests;
DROP POLICY IF EXISTS "Approvers update preschedule" ON public.preschedule_requests;
DROP POLICY IF EXISTS "update change target or supervisor" ON public.schedule_change_requests;

CREATE POLICY "area mgr deletes staff" ON public.staff FOR DELETE TO authenticated
  USING (public.is_area_manager_of(area));
CREATE POLICY "area mgr inserts staff" ON public.staff FOR INSERT TO authenticated
  WITH CHECK (public.is_area_manager_of(area));
CREATE POLICY "area mgr or self updates staff" ON public.staff FOR UPDATE TO authenticated
  USING (public.is_area_manager_of(area) OR lower(email) = public.current_email())
  WITH CHECK (public.is_area_manager_of(area) OR lower(email) = public.current_email());

CREATE POLICY "area mgr delete shifts" ON public.shifts FOR DELETE TO authenticated
  USING (public.is_area_manager_of(area));
CREATE POLICY "area mgr insert shifts" ON public.shifts FOR INSERT TO authenticated
  WITH CHECK (public.is_area_manager_of(area));
CREATE POLICY "area mgr update shifts" ON public.shifts FOR UPDATE TO authenticated
  USING (public.is_area_manager_of(area))
  WITH CHECK (public.is_area_manager_of(area));

CREATE POLICY "area mgr update leave" ON public.leave_requests FOR UPDATE TO authenticated
  USING (public.is_area_manager_of(area) OR lower(coalesce(approver_email,'')) = public.current_email())
  WITH CHECK (public.is_area_manager_of(area) OR lower(coalesce(approver_email,'')) = public.current_email());

CREATE POLICY "area mgr update preschedule" ON public.preschedule_requests FOR UPDATE TO authenticated
  USING (public.is_area_manager_of(area) OR lower(coalesce(approver_email,'')) = public.current_email())
  WITH CHECK (public.is_area_manager_of(area) OR lower(coalesce(approver_email,'')) = public.current_email());

CREATE POLICY "target or area mgr update change" ON public.schedule_change_requests FOR UPDATE TO authenticated
  USING (
    lower(target_staff_email) = public.current_email()
    OR lower(requester_email) = public.current_email()
    OR public.is_area_manager_of(area)
    OR lower(coalesce(approver_email,'')) = public.current_email()
  )
  WITH CHECK (
    lower(target_staff_email) = public.current_email()
    OR lower(requester_email) = public.current_email()
    OR public.is_area_manager_of(area)
    OR lower(coalesce(approver_email,'')) = public.current_email()
  );

-- ============ 1b. Prevent self-privilege escalation on staff ============
CREATE OR REPLACE FUNCTION public.staff_guard_privileges()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller_email text := public.current_email();
  caller_is_admin boolean := public.is_admin();
  caller_role text := current_setting('request.jwt.claims', true)::jsonb->>'role';
BEGIN
  -- service_role bypasses
  IF caller_role = 'service_role' THEN RETURN NEW; END IF;
  IF caller_is_admin THEN RETURN NEW; END IF;

  -- Non-admin: cannot change security-sensitive columns on ANY row
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.badge_id IS DISTINCT FROM OLD.badge_id
     OR NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    RAISE EXCEPTION 'Not permitted to change security columns';
  END IF;

  -- On OWN row, cannot change role/area/supervisor_email
  IF lower(NEW.email) = caller_email THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.area IS DISTINCT FROM OLD.area
       OR NEW.supervisor_email IS DISTINCT FROM OLD.supervisor_email THEN
      RAISE EXCEPTION 'Users cannot change role/area/supervisor on own record';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS staff_guard_privileges_trg ON public.staff;
CREATE TRIGGER staff_guard_privileges_trg
  BEFORE UPDATE ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.staff_guard_privileges();

-- ============ 1e. Tamper-proof audit log ============
CREATE OR REPLACE FUNCTION public.audit_log_stamp_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller_email text := public.current_email();
  caller_role_setting text := current_setting('request.jwt.claims', true)::jsonb->>'role';
  s_role text;
BEGIN
  IF caller_role_setting = 'service_role' OR caller_email IS NULL OR caller_email = '' THEN
    -- system caller: keep provided values
    RETURN NEW;
  END IF;
  SELECT role::text INTO s_role FROM public.staff WHERE lower(email) = caller_email LIMIT 1;
  NEW.actor_email := caller_email;
  NEW.actor_role := coalesce(s_role, 'staff');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS audit_log_stamp_actor_trg ON public.audit_logs;
CREATE TRIGGER audit_log_stamp_actor_trg
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_stamp_actor();

REVOKE UPDATE, DELETE ON public.audit_logs FROM authenticated;

-- ============ 2a. staff_id linkage ============
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE public.preschedule_requests ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE public.schedule_change_requests
  ADD COLUMN IF NOT EXISTS requester_staff_id uuid REFERENCES public.staff(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS target_staff_id uuid REFERENCES public.staff(id) ON DELETE CASCADE;

UPDATE public.shifts s SET staff_id = st.id
  FROM public.staff st WHERE s.staff_id IS NULL AND lower(st.email) = lower(s.staff_email);
UPDATE public.leave_requests r SET staff_id = st.id
  FROM public.staff st WHERE r.staff_id IS NULL AND lower(st.email) = lower(r.staff_email);
UPDATE public.preschedule_requests r SET staff_id = st.id
  FROM public.staff st WHERE r.staff_id IS NULL AND lower(st.email) = lower(r.requester_email);
UPDATE public.schedule_change_requests r SET requester_staff_id = st.id
  FROM public.staff st WHERE r.requester_staff_id IS NULL AND lower(st.email) = lower(r.requester_email);
UPDATE public.schedule_change_requests r SET target_staff_id = st.id
  FROM public.staff st WHERE r.target_staff_id IS NULL AND lower(st.email) = lower(r.target_staff_email);

-- ============ 2b. Unique (staff_id, date) — dedupe first ============
DELETE FROM public.shifts a USING public.shifts b
  WHERE a.ctid < b.ctid
    AND a.staff_id IS NOT NULL AND a.staff_id = b.staff_id
    AND a.date = b.date;
CREATE UNIQUE INDEX IF NOT EXISTS shifts_staff_id_date_uniq ON public.shifts(staff_id, date) WHERE staff_id IS NOT NULL;

-- ============ 3d. notifications table ============
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own notifications read" ON public.notifications FOR SELECT TO authenticated
  USING (recipient_staff_id IN (SELECT id FROM public.staff WHERE lower(email) = public.current_email()));
CREATE POLICY "own notifications update" ON public.notifications FOR UPDATE TO authenticated
  USING (recipient_staff_id IN (SELECT id FROM public.staff WHERE lower(email) = public.current_email()))
  WITH CHECK (recipient_staff_id IN (SELECT id FROM public.staff WHERE lower(email) = public.current_email()));

CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON public.notifications(recipient_staff_id, created_at DESC);

-- ============ Badge sign-in throttle table ============
CREATE TABLE IF NOT EXISTS public.badge_signin_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_id text NOT NULL,
  succeeded boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.badge_signin_attempts TO service_role;
ALTER TABLE public.badge_signin_attempts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS badge_attempts_idx ON public.badge_signin_attempts(badge_id, created_at DESC);
