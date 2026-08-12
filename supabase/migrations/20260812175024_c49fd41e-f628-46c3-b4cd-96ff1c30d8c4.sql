ALTER TABLE public.staff ALTER COLUMN email DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.staff_dependents(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  em text;
BEGIN
  SELECT lower(coalesce(email, '')) INTO em FROM public.staff WHERE id = _id;
  RETURN jsonb_build_object(
    'leave_requests', (SELECT count(*) FROM public.leave_requests l
       WHERE l.staff_id = _id OR (em <> '' AND lower(l.staff_email) = em)),
    'shifts', (SELECT count(*) FROM public.shifts s
       WHERE s.staff_id = _id OR (em <> '' AND lower(s.staff_email) = em)),
    'preschedule_requests', (SELECT count(*) FROM public.preschedule_requests p
       WHERE p.staff_id = _id OR (em <> '' AND lower(p.requester_email) = em)),
    'schedule_change_requests', (SELECT count(*) FROM public.schedule_change_requests c
       WHERE c.requester_staff_id = _id OR c.target_staff_id = _id),
    'notifications', (SELECT count(*) FROM public.notifications n WHERE n.recipient_staff_id = _id),
    'overrides', (SELECT count(*) FROM public.regular_shift_overrides o WHERE o.staff_id = _id)
  );
END $$;

REVOKE ALL ON FUNCTION public.staff_dependents(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_dependents(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_staff(_id uuid, _cascade boolean DEFAULT false, _force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s record;
  em text;
  removed jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins may delete staff records';
  END IF;
  SELECT * INTO s FROM public.staff WHERE id = _id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Staff record not found'; END IF;

  IF (btrim(coalesce(s.name, '')) ILIKE 'test%' OR btrim(coalesce(s.first_name, '')) ILIKE 'test%')
     AND NOT _force THEN
    RAISE EXCEPTION 'Protected test record — % cannot be deleted', s.name;
  END IF;

  em := lower(coalesce(s.email, ''));

  IF _cascade THEN
    removed := public.staff_dependents(_id);
    DELETE FROM public.vacation_change_requests v
      USING public.leave_requests l
     WHERE v.leave_request_id = l.id
       AND (l.staff_id = _id OR (em <> '' AND lower(l.staff_email) = em));
    DELETE FROM public.leave_requests l
     WHERE l.staff_id = _id OR (em <> '' AND lower(l.staff_email) = em);
    DELETE FROM public.shifts sh
     WHERE sh.staff_id = _id OR (em <> '' AND lower(sh.staff_email) = em);
    DELETE FROM public.preschedule_requests p
     WHERE p.staff_id = _id OR (em <> '' AND lower(p.requester_email) = em);
    DELETE FROM public.schedule_change_requests c
     WHERE c.requester_staff_id = _id OR c.target_staff_id = _id;
    DELETE FROM public.notifications n WHERE n.recipient_staff_id = _id;
    DELETE FROM public.regular_shift_overrides o WHERE o.staff_id = _id;
  END IF;

  DELETE FROM public.staff_secrets WHERE staff_id = _id;
  DELETE FROM public.staff WHERE id = _id;

  INSERT INTO public.audit_logs (action, entity_type, entity_id, area, details)
  VALUES ('staff.delete', 'staff', _id::text, s.area,
          jsonb_build_object('name', s.name, 'badge_id', s.badge_id,
                             'email', s.email, 'cascade', _cascade,
                             'forced', _force, 'removed', removed));

  RETURN jsonb_build_object('deleted', true, 'removed', removed);
END $$;

REVOKE ALL ON FUNCTION public.admin_delete_staff(uuid, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_staff(uuid, boolean, boolean) TO authenticated;