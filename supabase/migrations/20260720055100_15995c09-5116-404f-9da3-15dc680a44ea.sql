
-- Enums
CREATE TYPE public.app_role AS ENUM ('staff', 'supervisor', 'admin');
CREATE TYPE public.shift_type AS ENUM ('Morning', 'Evening', 'Night', 'Off');
CREATE TYPE public.leave_type AS ENUM ('Vacation', 'Sick');
CREATE TYPE public.leave_status AS ENUM ('Pending', 'Approved', 'Rejected');
CREATE TYPE public.change_type AS ENUM ('give_ot', 'switch_area', 'switch_date');
CREATE TYPE public.staff_response AS ENUM ('Pending', 'Accepted', 'Declined');
CREATE TYPE public.supervisor_response AS ENUM ('Pending', 'Approved', 'Rejected');
CREATE TYPE public.change_status AS ENUM ('Pending Staff', 'Pending Supervisor', 'Approved', 'Rejected');

-- Staff
CREATE TABLE public.staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role public.app_role NOT NULL DEFAULT 'staff',
  area text,
  department text,
  supervisor_email text,
  delegated_to_email text,
  delegation_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff TO authenticated;
GRANT ALL ON public.staff TO service_role;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

-- Shifts
CREATE TABLE public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_email text NOT NULL,
  staff_name text NOT NULL,
  area text NOT NULL,
  date date NOT NULL,
  shift_type public.shift_type NOT NULL,
  hours numeric NOT NULL DEFAULT 8,
  is_overtime boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shifts TO authenticated;
GRANT ALL ON public.shifts TO service_role;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

-- Leave requests
CREATE TABLE public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_email text NOT NULL,
  staff_name text NOT NULL,
  area text NOT NULL,
  leave_type public.leave_type NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  status public.leave_status NOT NULL DEFAULT 'Pending',
  approver_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_requests TO authenticated;
GRANT ALL ON public.leave_requests TO service_role;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

-- Schedule change requests
CREATE TABLE public.schedule_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_email text NOT NULL,
  requester_name text NOT NULL,
  area text NOT NULL,
  change_type public.change_type NOT NULL,
  source_shift_id uuid NOT NULL,
  target_staff_email text NOT NULL,
  target_staff_name text NOT NULL,
  target_shift_id uuid,
  details text,
  staff_response public.staff_response NOT NULL DEFAULT 'Pending',
  supervisor_response public.supervisor_response NOT NULL DEFAULT 'Pending',
  approver_email text,
  status public.change_status NOT NULL DEFAULT 'Pending Staff',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_change_requests TO authenticated;
GRANT ALL ON public.schedule_change_requests TO service_role;
ALTER TABLE public.schedule_change_requests ENABLE ROW LEVEL SECURITY;

-- Helper functions
CREATE OR REPLACE FUNCTION public.current_email()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lower(coalesce((auth.jwt() ->> 'email'), ''))
$$;

CREATE OR REPLACE FUNCTION public.my_role()
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.staff WHERE lower(email) = public.current_email() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.my_area()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT area FROM public.staff WHERE lower(email) = public.current_email() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.my_role() = 'admin'
$$;

CREATE OR REPLACE FUNCTION public.is_supervisor_of(_area text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff
    WHERE lower(email) = public.current_email()
      AND role = 'supervisor'
      AND area = _area
  )
$$;

-- STAFF policies
CREATE POLICY "read own area or admin" ON public.staff FOR SELECT TO authenticated
USING (public.is_admin() OR area = public.my_area() OR lower(email) = public.current_email());

CREATE POLICY "supervisor manages area staff" ON public.staff FOR INSERT TO authenticated
WITH CHECK (public.is_supervisor_of(area));

CREATE POLICY "supervisor updates area staff" ON public.staff FOR UPDATE TO authenticated
USING (public.is_supervisor_of(area) OR lower(email) = public.current_email())
WITH CHECK (public.is_supervisor_of(area) OR lower(email) = public.current_email());

CREATE POLICY "supervisor deletes area staff" ON public.staff FOR DELETE TO authenticated
USING (public.is_supervisor_of(area));

-- SHIFTS policies
CREATE POLICY "read shifts area or admin" ON public.shifts FOR SELECT TO authenticated
USING (public.is_admin() OR area = public.my_area());

CREATE POLICY "supervisor insert shifts" ON public.shifts FOR INSERT TO authenticated
WITH CHECK (public.is_supervisor_of(area));

CREATE POLICY "supervisor update shifts" ON public.shifts FOR UPDATE TO authenticated
USING (public.is_supervisor_of(area)) WITH CHECK (public.is_supervisor_of(area));

CREATE POLICY "supervisor delete shifts" ON public.shifts FOR DELETE TO authenticated
USING (public.is_supervisor_of(area));

-- LEAVE policies
CREATE POLICY "read leave area or admin" ON public.leave_requests FOR SELECT TO authenticated
USING (public.is_admin() OR area = public.my_area() OR lower(staff_email) = public.current_email());

CREATE POLICY "insert own leave" ON public.leave_requests FOR INSERT TO authenticated
WITH CHECK (lower(staff_email) = public.current_email());

CREATE POLICY "supervisor update leave" ON public.leave_requests FOR UPDATE TO authenticated
USING (public.is_supervisor_of(area) OR lower(approver_email) = public.current_email())
WITH CHECK (public.is_supervisor_of(area) OR lower(approver_email) = public.current_email());

-- CHANGE REQUEST policies
CREATE POLICY "read change area or admin or party" ON public.schedule_change_requests FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR area = public.my_area()
  OR lower(requester_email) = public.current_email()
  OR lower(target_staff_email) = public.current_email()
);

CREATE POLICY "insert own change" ON public.schedule_change_requests FOR INSERT TO authenticated
WITH CHECK (lower(requester_email) = public.current_email());

CREATE POLICY "update change target or supervisor" ON public.schedule_change_requests FOR UPDATE TO authenticated
USING (
  lower(target_staff_email) = public.current_email()
  OR public.is_supervisor_of(area)
  OR lower(approver_email) = public.current_email()
)
WITH CHECK (
  lower(target_staff_email) = public.current_email()
  OR public.is_supervisor_of(area)
  OR lower(approver_email) = public.current_email()
);
