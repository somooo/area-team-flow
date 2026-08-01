CREATE OR REPLACE FUNCTION public.is_area_manager_of(_area text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.staff
    WHERE lower(email) = public.current_email()
      AND role IN ('supervisor','team_leader')
      AND area = _area
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_supervisor_of(_area text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.staff
    WHERE lower(email) = public.current_email()
      AND role = 'supervisor'
      AND area = _area
  )
$function$;