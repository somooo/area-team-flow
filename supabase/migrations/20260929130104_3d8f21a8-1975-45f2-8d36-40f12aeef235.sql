REVOKE EXECUTE ON FUNCTION public.resolve_approver(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_approver(text) TO authenticated, service_role;