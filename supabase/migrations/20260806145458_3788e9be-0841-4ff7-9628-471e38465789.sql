DROP POLICY IF EXISTS "area mgr or self updates staff" ON public.staff;
CREATE POLICY "area mgr or self updates staff"
ON public.staff FOR UPDATE TO authenticated
USING (is_area_manager_of(area) OR area IS NULL OR lower(email) = current_email())
WITH CHECK (is_area_manager_of(area) OR lower(email) = current_email());