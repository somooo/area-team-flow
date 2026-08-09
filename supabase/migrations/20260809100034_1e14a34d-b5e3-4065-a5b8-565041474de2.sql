CREATE OR REPLACE FUNCTION public.import_schedule_month(
  _area text,
  _start date,
  _end date,
  _replace boolean,
  _rows jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  written integer := 0;
BEGIN
  IF NOT (public.is_admin() OR public.is_area_manager_of(_area)) THEN
    RAISE EXCEPTION 'Not allowed to import schedules for %', _area;
  END IF;

  IF _replace THEN
    DELETE FROM public.shifts s
     WHERE s.area = _area AND s.date >= _start AND s.date <= _end;
  END IF;

  WITH src AS (
    SELECT DISTINCT ON (r.staff_id, r.date) r.*
      FROM jsonb_to_recordset(_rows) AS r(
        staff_email text, staff_name text, staff_id uuid, area text, date date,
        duty duty_type, unit_code text, ot_type ot_type, is_overtime boolean,
        sick_tag boolean, hours numeric, shift_type shift_type
      )
     ORDER BY r.staff_id, r.date
  ), del AS (
    DELETE FROM public.shifts s
     USING src
     WHERE s.staff_id IS NOT DISTINCT FROM src.staff_id
       AND s.date = src.date
       AND s.area = src.area
    RETURNING 1
  ), ins AS (
    INSERT INTO public.shifts (staff_email, staff_name, staff_id, area, date, duty,
                               unit_code, ot_type, is_overtime, sick_tag, hours, shift_type)
    SELECT staff_email, staff_name, staff_id, area, date, duty,
           unit_code, ot_type, is_overtime, sick_tag, hours, shift_type
      FROM src
    RETURNING 1
  )
  SELECT count(*) INTO written FROM ins;

  RETURN written;
END $$;

REVOKE EXECUTE ON FUNCTION public.import_schedule_month(text, date, date, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_schedule_month(text, date, date, boolean, jsonb) TO authenticated, service_role;