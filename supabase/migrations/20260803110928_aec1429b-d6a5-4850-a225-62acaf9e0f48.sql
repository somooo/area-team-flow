ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS position text,
  ADD COLUMN IF NOT EXISTS date_of_hire date,
  ADD COLUMN IF NOT EXISTS assigned_to text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Active',
  ADD COLUMN IF NOT EXISTS extension text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.staff_custom_columns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_custom_columns TO authenticated;
GRANT ALL ON public.staff_custom_columns TO service_role;

ALTER TABLE public.staff_custom_columns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read custom columns"
  ON public.staff_custom_columns FOR SELECT TO authenticated USING (true);

CREATE POLICY "managers insert custom columns"
  ON public.staff_custom_columns FOR INSERT TO authenticated
  WITH CHECK (public.my_role() IN ('admin','supervisor'));

CREATE POLICY "managers update custom columns"
  ON public.staff_custom_columns FOR UPDATE TO authenticated
  USING (public.my_role() IN ('admin','supervisor'))
  WITH CHECK (public.my_role() IN ('admin','supervisor'));

CREATE POLICY "managers delete custom columns"
  ON public.staff_custom_columns FOR DELETE TO authenticated
  USING (public.my_role() IN ('admin','supervisor'));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER update_staff_custom_columns_updated_at
  BEFORE UPDATE ON public.staff_custom_columns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();