-- 1. Capabilities: fixed vocabulary, seeded here, never written from the UI
CREATE TABLE public.capabilities (
  key text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL,
  area_scoped boolean NOT NULL DEFAULT true,
  description text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);
GRANT SELECT ON public.capabilities TO authenticated;
GRANT ALL ON public.capabilities TO service_role;
ALTER TABLE public.capabilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "capabilities readable" ON public.capabilities FOR SELECT TO authenticated USING (true);

-- 2. Roles
CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  is_builtin boolean NOT NULL DEFAULT false,
  is_superuser boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roles TO authenticated;
GRANT ALL ON public.roles TO service_role;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles readable" ON public.roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "roles admin write" ON public.roles FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE TRIGGER trg_roles_updated BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Role capabilities
CREATE TABLE public.role_capabilities (
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  capability_key text NOT NULL REFERENCES public.capabilities(key),
  PRIMARY KEY (role_id, capability_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_capabilities TO authenticated;
GRANT ALL ON public.role_capabilities TO service_role;
ALTER TABLE public.role_capabilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "role caps readable" ON public.role_capabilities FOR SELECT TO authenticated USING (true);
CREATE POLICY "role caps admin write" ON public.role_capabilities FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 4. Role assignments
CREATE TABLE public.role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id),
  area text,
  start_date date,
  end_date date,
  reason text,
  granted_by_email text NOT NULL,
  revoked_at timestamptz,
  revoked_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX role_assignments_lookup_idx
  ON public.role_assignments (staff_id, area, start_date, end_date);
CREATE INDEX role_assignments_staff_idx ON public.role_assignments (staff_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_assignments TO authenticated;
GRANT ALL ON public.role_assignments TO service_role;
ALTER TABLE public.role_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assignments readable" ON public.role_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "assignments admin write" ON public.role_assignments FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 5. Area aliases
CREATE TABLE public.area_aliases (
  alias text PRIMARY KEY,
  area text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.area_aliases TO authenticated;
GRANT ALL ON public.area_aliases TO service_role;
ALTER TABLE public.area_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aliases readable" ON public.area_aliases FOR SELECT TO authenticated USING (true);
CREATE POLICY "aliases admin write" ON public.area_aliases FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 6. Real active flag on staff (backfilled from free-text status)
ALTER TABLE public.staff ADD COLUMN is_active boolean NOT NULL DEFAULT true;
UPDATE public.staff SET is_active = false
 WHERE lower(coalesce(status, '')) ~ '(resign|terminat|retire|transferr|not under the department|moved to|royal cl)';

-- 7. Seed capabilities
INSERT INTO public.capabilities (key, label, category, area_scoped, description, sort_order) VALUES
 ('schedule.view','View schedules','Schedule',false,'See the monthly schedule grid for any area.',10),
 ('schedule.edit','Edit schedule','Schedule',true,'Change shift cells in an area schedule.',20),
 ('schedule.import','Import schedule','Schedule',true,'Upload an Excel schedule for an area.',30),
 ('schedule.replace_month','Replace a schedule month','Schedule',true,'Wipe and replace a whole month during import.',40),
 ('leave.view','View leave','Leave',true,'See leave and vacation records for an area.',50),
 ('leave.request_own','Request own leave','Leave',false,'Submit a leave request for yourself.',60),
 ('leave.cancel_own','Cancel own leave','Leave',false,'Cancel or request a change to your own pending leave.',70),
 ('leave.approve','Approve leave','Leave',true,'Approve or reject leave requests in an area.',80),
 ('leave.manage','Manage leave','Leave',true,'Directly edit, adjust or cancel anyone''s leave in an area.',90),
 ('leave.import','Import leave','Leave',true,'Bulk import vacations from Excel.',100),
 ('request.create_own','Create own requests','Requests',false,'Raise pre-schedule, swap or overtime requests for yourself.',110),
 ('request.accept_own','Respond to own requests','Requests',false,'Accept or decline a request that names you.',120),
 ('request.approve','Approve requests','Requests',true,'Approve or reject schedule and pre-schedule requests in an area.',130),
 ('directory.view','View staff directory','Directory',true,'See staff records for an area.',140),
 ('directory.edit','Edit staff directory','Directory',true,'Add, edit or remove staff records in an area.',150),
 ('directory.import','Import staff directory','Directory',true,'Bulk import staff records from Excel.',160),
 ('profile.edit_own','Edit own profile','Directory',false,'Change your own contact details.',170),
 ('reports.view','View reports','Reports',true,'Open reports and exports for an area.',180),
 ('codes.manage','Manage codes and reference data','System',true,'Edit assignment codes, zones and import profiles.',190),
 ('overrides.manage','Manage shift overrides','System',true,'Set regular-shift overrides for staff.',200),
 ('settings.manage','Manage system settings','System',false,'Change system rules and caps.',210),
 ('audit.view','View audit log','System',false,'Read the audit trail.',220),
 ('roles.manage','Manage roles','System',false,'Create roles and change which capabilities they include.',230),
 ('assignments.manage','Assign roles to people','System',true,'Grant or revoke roles for staff in an area.',240);

-- 8. Seed built-in roles
INSERT INTO public.roles (key, label, description, is_builtin, is_superuser, sort_order) VALUES
 ('admin','Admin','Unrestricted access to every area and setting.', true, true, 10),
 ('supervisor','Supervisor','Runs the schedule, leave and staff for their area.', true, false, 20),
 ('team_leader','Team Leader','Currently the same as Staff; extra powers can be granted here.', true, false, 30),
 ('staff','Staff','Sees schedules and manages their own leave and requests.', true, false, 40);

-- 9. Seed role capabilities (Admin is superuser and gets no rows)
INSERT INTO public.role_capabilities (role_id, capability_key)
SELECT r.id, c.key FROM public.roles r, public.capabilities c
 WHERE r.key = 'supervisor'
   AND c.key IN ('schedule.view','schedule.edit','schedule.import','schedule.replace_month',
                 'leave.view','leave.request_own','leave.cancel_own','leave.approve','leave.manage','leave.import',
                 'request.create_own','request.accept_own','request.approve',
                 'directory.view','directory.edit','directory.import','profile.edit_own',
                 'reports.view','codes.manage','overrides.manage','assignments.manage');

INSERT INTO public.role_capabilities (role_id, capability_key)
SELECT r.id, c.key FROM public.roles r, public.capabilities c
 WHERE r.key IN ('staff','team_leader')
   AND c.key IN ('schedule.view','leave.view','leave.request_own','leave.cancel_own',
                 'request.create_own','request.accept_own','profile.edit_own');

-- 10. Seed area aliases from the observed directory values
INSERT INTO public.area_aliases (alias, area) VALUES
 ('rt icus','ICU'),
 ('rt wards','Wards'),
 ('rt sang','SANG'),
 ('rt equipment','Equipment'),
 ('rt pulmonary rehabilitation','Pulmonary Rehabilitation'),
 ('rt pft','PFT'),
 ('rt supervisors','Supervisors'),
 ('rt home health care','Home Health Care'),
 ('admin assistants','Administration'),
 ('a/manager','Administration'),
 ('scdp','SCDP'),
 ('a/director','Administration'),
 ('a/ wards supervisor','Wards'),
 ('a/ quality supervisors','Supervisors'),
 ('rt educator','Education');