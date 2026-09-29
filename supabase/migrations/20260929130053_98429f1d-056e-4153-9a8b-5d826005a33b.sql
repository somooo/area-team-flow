CREATE OR REPLACE FUNCTION public.resolve_approver(_area text DEFAULT NULL)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH cand AS (
    SELECT s.email,
           s.delegation_active,
           s.delegated_to_email,
           CASE
             WHEN r.is_superuser THEN 3
             WHEN ra.area IS NOT NULL AND ra.area = _area THEN 1
             ELSE 2
           END AS pri
      FROM public.role_assignments ra
      JOIN public.roles r ON r.id = ra.role_id
      JOIN public.staff s ON s.id = ra.staff_id
      LEFT JOIN public.role_capabilities rc
        ON rc.role_id = r.id AND rc.capability_key = 'leave.approve'
     WHERE s.is_active
       AND coalesce(s.status, 'Active') = 'Active'
       AND coalesce(s.email, '') <> ''
       AND ra.revoked_at IS NULL
       AND (ra.start_date IS NULL OR ra.start_date <= current_date)
       AND (ra.end_date IS NULL OR ra.end_date >= current_date)
       AND (r.is_superuser OR rc.capability_key IS NOT NULL)
       AND (ra.area IS NULL OR ra.area = _area)
  )
  SELECT CASE
           WHEN c.delegation_active AND coalesce(c.delegated_to_email, '') <> ''
             THEN lower(c.delegated_to_email)
           ELSE lower(c.email)
         END
    FROM cand c
   ORDER BY c.pri, c.email
   LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.resolve_approver(text) TO authenticated, anon, service_role;

ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS sla_deadline_at timestamptz;
ALTER TABLE public.preschedule_requests ADD COLUMN IF NOT EXISTS sla_deadline_at timestamptz;
ALTER TABLE public.schedule_change_requests ADD COLUMN IF NOT EXISTS sla_deadline_at timestamptz;