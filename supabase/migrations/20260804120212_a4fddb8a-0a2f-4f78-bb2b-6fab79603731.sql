-- 1. Lock down SECURITY DEFINER functions
REVOKE ALL ON FUNCTION public.current_email() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_area() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_supervisor_of(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_area_manager_of(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.audit_log_stamp_actor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_guard_privileges() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_leave_to_shifts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_preschedule_to_shifts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revert_request_shifts(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_absence_to_shifts(text, text, text, date[], duty_type, text, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.current_email() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_area() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_supervisor_of(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_area_manager_of(text) TO authenticated;

-- 2. staff_directory view runs with the querying user's permissions
ALTER VIEW public.staff_directory SET (security_invoker = on);

-- 3. Never expose password_hash to API clients (column-level privileges)
REVOKE SELECT ON public.staff FROM anon, authenticated;
GRANT SELECT (id, name, email, role, area, department, supervisor_email, delegated_to_email,
              delegation_active, created_at, badge_id, first_name, last_name, "position",
              date_of_hire, assigned_to, status, extension, notes, custom_fields, supervisor)
  ON public.staff TO authenticated;
REVOKE UPDATE ON public.staff FROM anon, authenticated;
GRANT UPDATE (name, email, role, area, department, supervisor_email, delegated_to_email,
              delegation_active, badge_id, first_name, last_name, "position",
              date_of_hire, assigned_to, status, extension, notes, custom_fields, supervisor)
  ON public.staff TO authenticated;
GRANT ALL ON public.staff TO service_role;

-- 4. Scope shift reads to the user's own area / own shifts (admins keep full view)
DROP POLICY IF EXISTS "authenticated read all shifts" ON public.shifts;
CREATE POLICY "read shifts in own area" ON public.shifts
  FOR SELECT TO authenticated
  USING (public.is_admin() OR area = public.my_area() OR lower(staff_email) = public.current_email());

-- 5. system_rules require sign-in
DROP POLICY IF EXISTS "Anyone can read system rules" ON public.system_rules;
CREATE POLICY "Authenticated read system rules" ON public.system_rules
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.system_rules FROM anon;