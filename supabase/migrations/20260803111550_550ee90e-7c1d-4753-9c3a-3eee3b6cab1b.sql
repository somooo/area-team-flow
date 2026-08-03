GRANT SELECT (first_name, last_name, position, date_of_hire, assigned_to, status, extension, notes, supervisor, custom_fields) ON public.staff TO authenticated;
GRANT UPDATE (first_name, last_name, position, date_of_hire, assigned_to, status, extension, notes, supervisor, custom_fields) ON public.staff TO authenticated;
GRANT INSERT (first_name, last_name, position, date_of_hire, assigned_to, status, extension, notes, supervisor, custom_fields) ON public.staff TO authenticated;
GRANT ALL ON public.staff TO service_role;