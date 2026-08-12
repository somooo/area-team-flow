ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.zone_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area text NOT NULL,
  assignment_no text NOT NULL,
  unit text NOT NULL,
  zone text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (area, assignment_no)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.zone_assignments TO authenticated;
GRANT ALL ON public.zone_assignments TO service_role;

ALTER TABLE public.zone_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zone_assignments_read" ON public.zone_assignments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "zone_assignments_write" ON public.zone_assignments
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TRIGGER zone_assignments_touch BEFORE UPDATE ON public.zone_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.zone_assignments (area, assignment_no, unit, zone, sort_order) VALUES
  ('ICU','5','PCICU I,II','ZONE I',10),
  ('ICU','12','PCICU I,II','ZONE I',11),
  ('ICU','27','PCICU I,II','ZONE I',12),
  ('ICU','6','CTS & T ICU','ZONE I',13),
  ('ICU','11','CTS & T ICU','ZONE I',14),
  ('ICU','17','MCICU','ZONE I',15),
  ('ICU','10','GICU','ZONE II',20),
  ('ICU','15','GICU','ZONE II',21),
  ('ICU','18','PRU','ZONE II',22),
  ('ICU','19','PRU','ZONE II',23),
  ('ICU','22','Neuro ICU','ZONE II',24),
  ('ICU','35','RICU','ZONE II',25),
  ('ICU','36','RICU','ZONE II',26),
  ('ICU','37','RICU','ZONE II',27),
  ('ICU','2','MICU','ZONE III',30),
  ('ICU','3','MICU','ZONE III',31),
  ('ICU','7','MICU','ZONE III',32),
  ('ICU','9','MICU','ZONE III',33),
  ('ICU','33','TICU','ZONE III',34),
  ('ICU','34','TICU','ZONE III',35),
  ('ICU','13','CCRT','ZONE III',36),
  ('ICU','8','ER','ZONE IV',40),
  ('ICU','30','Burn','ZONE IV',41),
  ('ICU','31','SICU','ZONE IV',42)
ON CONFLICT (area, assignment_no) DO NOTHING;

CREATE OR REPLACE FUNCTION public.import_schedule_rows(_area text, _start date, _end date, _replace boolean, _rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        staff_email text, staff_name text, staff_id text, area text, date text,
        duty text, unit_code text, ot_type text, is_overtime boolean,
        sick_tag boolean, hours numeric, shift_type text, sort_order integer
      )
     ORDER BY x.staff_id, x.date
  LOOP
    attempted := attempted + 1;
    BEGIN
      DELETE FROM public.shifts s
       WHERE s.staff_id IS NOT DISTINCT FROM nullif(r.staff_id, '')::uuid
         AND s.date = r.date::date AND s.area = r.area;
      INSERT INTO public.shifts (staff_email, staff_name, staff_id, area, date, duty,
                                 unit_code, ot_type, is_overtime, sick_tag, hours, shift_type, sort_order)
      VALUES (r.staff_email, r.staff_name, nullif(r.staff_id, '')::uuid, r.area, r.date::date,
              r.duty::duty_type, r.unit_code, coalesce(r.ot_type, 'None')::ot_type,
              coalesce(r.is_overtime, false), coalesce(r.sick_tag, false),
              coalesce(r.hours, 0), r.shift_type::shift_type, coalesce(r.sort_order, 0));
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
END $function$;