CREATE POLICY "area mgr insert leave" ON public.leave_requests
FOR INSERT TO authenticated
WITH CHECK (public.is_admin() OR public.is_area_manager_of(area));