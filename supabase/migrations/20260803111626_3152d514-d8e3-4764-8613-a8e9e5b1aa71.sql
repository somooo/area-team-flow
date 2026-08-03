CREATE OR REPLACE VIEW public.staff_directory
WITH (security_invoker = on) AS
SELECT id, name, first_name, last_name, position, badge_id, date_of_hire, email,
       assigned_to, status, supervisor, supervisor_email, extension, notes, area, role, custom_fields
FROM public.staff
WHERE public.my_role() IN ('admin','supervisor');

GRANT SELECT ON public.staff_directory TO authenticated;
GRANT ALL ON public.staff_directory TO service_role;

GRANT UPDATE (badge_id), INSERT (badge_id) ON public.staff TO authenticated;