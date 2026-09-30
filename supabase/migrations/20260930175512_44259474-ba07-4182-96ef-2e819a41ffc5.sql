CREATE OR REPLACE FUNCTION public.is_roster_member()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff s
    WHERE lower(s.email) = public.current_email() AND public.current_email() <> '' AND s.is_active)
$$;
REVOKE EXECUTE ON FUNCTION public.is_roster_member() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_roster_member() TO authenticated;

ALTER POLICY "zone_assignments_read" ON public.zone_assignments USING (public.is_roster_member());
ALTER POLICY "aliases readable" ON public.area_aliases USING (public.is_roster_member());
ALTER POLICY "Authenticated can read schedule memberships" ON public.schedule_memberships USING (public.is_roster_member());
ALTER POLICY "read import profiles" ON public.import_profiles USING (public.is_roster_member());
ALTER POLICY "authenticated read all staff" ON public.staff USING (public.is_roster_member() OR lower(email) = public.current_email());
ALTER POLICY "capabilities readable" ON public.capabilities USING (auth.uid() IS NOT NULL);
ALTER POLICY "roles readable" ON public.roles USING (auth.uid() IS NOT NULL);
ALTER POLICY "read zone reference" ON public.zone_reference USING (public.is_roster_member());
ALTER POLICY "assignments readable" ON public.role_assignments USING (public.is_roster_member() OR staff_id IN (SELECT id FROM public.staff WHERE lower(email) = public.current_email()));
ALTER POLICY "authenticated read custom columns" ON public.staff_custom_columns USING (public.is_roster_member());
ALTER POLICY "read assignment codes" ON public.assignment_codes USING (public.is_roster_member());
ALTER POLICY "role caps readable" ON public.role_capabilities USING (auth.uid() IS NOT NULL);
ALTER POLICY "read regular shift overrides" ON public.regular_shift_overrides USING (public.is_roster_member());
ALTER POLICY "read caps" ON public.vacation_caps USING (public.is_roster_member());
ALTER POLICY "authenticated read all shifts" ON public.shifts USING (public.is_roster_member());
ALTER POLICY "Authenticated read system rules" ON public.system_rules USING (public.is_roster_member());