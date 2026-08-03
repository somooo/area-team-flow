ALTER VIEW public.staff_directory SET (security_invoker = off);
REVOKE ALL ON public.staff_directory FROM anon;