CREATE TABLE public.import_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area text NOT NULL,
  name text NOT NULL,
  layout jsonb NOT NULL,
  code_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (area, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_profiles TO authenticated;
GRANT ALL ON public.import_profiles TO service_role;
ALTER TABLE public.import_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read import profiles" ON public.import_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "managers write import profiles" ON public.import_profiles FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_supervisor_of(area))
  WITH CHECK (public.is_admin() OR public.is_supervisor_of(area));
CREATE TRIGGER trg_import_profiles_updated BEFORE UPDATE ON public.import_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.regular_shift_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  area text NOT NULL,
  year int NOT NULL,
  month int NOT NULL,
  regular_shifts int NOT NULL,
  reason text,
  set_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, area, year, month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.regular_shift_overrides TO authenticated;
GRANT ALL ON public.regular_shift_overrides TO service_role;
ALTER TABLE public.regular_shift_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read regular shift overrides" ON public.regular_shift_overrides FOR SELECT TO authenticated USING (true);
CREATE POLICY "managers write regular shift overrides" ON public.regular_shift_overrides FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_supervisor_of(area))
  WITH CHECK (public.is_admin() OR public.is_supervisor_of(area));
CREATE TRIGGER trg_regular_shift_overrides_updated BEFORE UPDATE ON public.regular_shift_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS shift_base_override int;
GRANT SELECT (shift_base_override), UPDATE (shift_base_override) ON public.staff TO authenticated;

ALTER TABLE public.system_rules ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'string';
ALTER TABLE public.system_rules ADD COLUMN IF NOT EXISTS "group" text NOT NULL DEFAULT 'General';
ALTER TABLE public.system_rules ADD CONSTRAINT system_rules_type_chk CHECK (type IN ('boolean','number','string','array'));

UPDATE public.system_rules SET type = CASE
  WHEN jsonb_typeof(value) = 'boolean' THEN 'boolean'
  WHEN jsonb_typeof(value) = 'number' THEN 'number'
  WHEN jsonb_typeof(value) = 'array' THEN 'array'
  ELSE 'string' END;

UPDATE public.system_rules SET "group" = CASE
  WHEN key LIKE 'vacation%' THEN 'Vacation'
  WHEN key LIKE 'preschedule%' OR key LIKE 'auto_approve%' THEN 'Pre-schedule'
  WHEN key LIKE 'ot_%' OR key LIKE 'sick_%' THEN 'Overtime'
  WHEN key LIKE 'import%' THEN 'Import'
  ELSE 'General' END;

INSERT INTO public.system_rules (key, value, description, type, "group") VALUES
  ('sick_ot_excluded_from_duty', 'true'::jsonb,
   'Sick days that fall on an overtime shift (BOT or AOT) are not counted as duty days', 'boolean', 'Overtime'),
  ('benefit_days_min_holidays', '5'::jsonb,
   'Number of leave days in a period after which 2 benefit days are added to the leave-day count used for regular shifts', 'number', 'Overtime')
ON CONFLICT (key) DO NOTHING;