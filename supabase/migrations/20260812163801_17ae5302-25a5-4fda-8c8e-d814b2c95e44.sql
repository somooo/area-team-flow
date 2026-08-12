-- Schedule import with per-row error capture
CREATE OR REPLACE FUNCTION public.import_schedule_rows(_area text, _start date, _end date, _replace boolean, _rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  written int := 0;
  attempted int := 0;
  failures jsonb := '[]'::jsonb;
  confirmed int := 0;
BEGIN
  IF NOT (public.is_admin() OR public.is_area_manager_of(_area)) THEN
    RAISE EXCEPTION 'Your account is not allowed to write the % schedule', _area;
  END IF;

  IF _replace THEN
    DELETE FROM public.shifts s WHERE s.area = _area AND s.date >= _start AND s.date <= _end;
  END IF;

  FOR r IN
    SELECT DISTINCT ON (x.staff_id, x.date) x.*
      FROM jsonb_to_recordset(_rows) AS x(
        staff_email text, staff_name text, staff_id uuid, area text, date date,
        duty duty_type, unit_code text, ot_type ot_type, is_overtime boolean,
        sick_tag boolean, hours numeric, shift_type shift_type
      )
     ORDER BY x.staff_id, x.date
  LOOP
    attempted := attempted + 1;
    BEGIN
      DELETE FROM public.shifts s
       WHERE s.staff_id IS NOT DISTINCT FROM r.staff_id AND s.date = r.date AND s.area = r.area;
      INSERT INTO public.shifts (staff_email, staff_name, staff_id, area, date, duty,
                                 unit_code, ot_type, is_overtime, sick_tag, hours, shift_type)
      VALUES (r.staff_email, r.staff_name, r.staff_id, r.area, r.date, r.duty,
              r.unit_code, r.ot_type, coalesce(r.is_overtime, false), coalesce(r.sick_tag, false),
              coalesce(r.hours, 0), r.shift_type);
      written := written + 1;
    EXCEPTION WHEN OTHERS THEN
      failures := failures || jsonb_build_object(
        'staff_name', r.staff_name, 'badge', r.staff_email, 'date', r.date, 'error', SQLERRM);
    END;
  END LOOP;

  SELECT count(*) INTO confirmed FROM public.shifts s
   WHERE s.area = _area AND s.date >= _start AND s.date <= _end;

  RETURN jsonb_build_object('attempted', attempted, 'written', written,
                            'confirmed', confirmed, 'failures', failures);
END $$;

REVOKE ALL ON FUNCTION public.import_schedule_rows(text, date, date, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_schedule_rows(text, date, date, boolean, jsonb) TO authenticated, service_role;

-- Vacation import with per-row error capture
CREATE OR REPLACE FUNCTION public.import_vacations_batch(_rows jsonb, _approver text, _override_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  new_id uuid;
  written int := 0;
  updated int := 0;
  attempted int := 0;
  results jsonb := '[]'::jsonb;
  s_role app_role;
BEGIN
  s_role := public.my_role();
  IF NOT (public.is_admin() OR s_role IN ('supervisor','team_leader')) THEN
    RAISE EXCEPTION 'Only admins, supervisors or team leaders may import vacations';
  END IF;

  FOR r IN
    SELECT x.* FROM jsonb_to_recordset(_rows) AS x(
      badge text, staff_id uuid, staff_email text, staff_name text,
      start_date date, end_date date, status leave_status,
      existing_id uuid, over_cap boolean
    )
  LOOP
    attempted := attempted + 1;
    BEGIN
      IF r.existing_id IS NOT NULL THEN
        UPDATE public.leave_requests
           SET status = r.status, approver_email = _approver,
               start_date = r.start_date, end_date = r.end_date,
               import_source = 'excel_import'
         WHERE id = r.existing_id
        RETURNING id INTO new_id;
        IF new_id IS NULL THEN
          RAISE EXCEPTION 'Existing vacation record no longer exists';
        END IF;
        updated := updated + 1;
        results := results || jsonb_build_object('badge', r.badge, 'name', r.staff_name,
          'range', r.start_date::text || ' → ' || r.end_date::text, 'status', 'updated', 'id', new_id);
      ELSE
        INSERT INTO public.leave_requests (
          staff_id, staff_email, staff_name, leave_type, start_date, end_date,
          status, approver_email, import_source, over_cap_override, over_cap_reason)
        VALUES (r.staff_id, lower(r.staff_email), r.staff_name, 'Vacation',
                r.start_date, r.end_date, r.status, _approver, 'excel_import',
                coalesce(r.over_cap, false),
                CASE WHEN coalesce(r.over_cap, false) THEN nullif(btrim(coalesce(_override_reason, '')), '') END)
        RETURNING id INTO new_id;
        written := written + 1;
        results := results || jsonb_build_object('badge', r.badge, 'name', r.staff_name,
          'range', r.start_date::text || ' → ' || r.end_date::text, 'status', 'written', 'id', new_id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      results := results || jsonb_build_object('badge', r.badge, 'name', r.staff_name,
        'range', r.start_date::text || ' → ' || r.end_date::text, 'status', 'failed', 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('attempted', attempted, 'written', written,
                            'updated', updated, 'rows', results);
END $$;

REVOKE ALL ON FUNCTION public.import_vacations_batch(jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_vacations_batch(jsonb, text, text) TO authenticated, service_role;