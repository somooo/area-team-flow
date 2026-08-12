CREATE TABLE public.schedule_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  area text NOT NULL,
  month_start date NOT NULL,
  side text NOT NULL CHECK (side IN ('Day','Night')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, area, month_start)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_memberships TO authenticated;
GRANT ALL ON public.schedule_memberships TO service_role;

ALTER TABLE public.schedule_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read schedule memberships"
  ON public.schedule_memberships FOR SELECT TO authenticated USING (true);

CREATE POLICY "Managers can write schedule memberships"
  ON public.schedule_memberships FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_supervisor_of(area))
  WITH CHECK (public.is_admin() OR public.is_supervisor_of(area));

CREATE TRIGGER schedule_memberships_touch
  BEFORE UPDATE ON public.schedule_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Cross-area rule: for one (staff, month) every membership must share the same side.
CREATE OR REPLACE FUNCTION public.enforce_membership_side_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  other RECORD;
  who text;
  badge text;
BEGIN
  SELECT s.name, coalesce(s.badge_id, '') INTO who, badge FROM public.staff s WHERE s.id = NEW.staff_id;
  SELECT m.area, m.side INTO other
  FROM public.schedule_memberships m
  WHERE m.staff_id = NEW.staff_id
    AND m.month_start = NEW.month_start
    AND m.id IS DISTINCT FROM NEW.id
    AND m.side <> NEW.side
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '% (badge %) is % in % for % and cannot be added to % %.',
      coalesce(who, 'This staff member'), badge, other.side, other.area,
      to_char(NEW.month_start, 'FMMonth YYYY'), NEW.area, NEW.side
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_membership_side_consistency
  BEFORE INSERT OR UPDATE ON public.schedule_memberships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_membership_side_consistency();

-- Keep memberships in step with the schedule itself.
CREATE OR REPLACE FUNCTION public.sync_schedule_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid uuid;
  m_start date;
  new_side text;
  existing RECORD;
  who text;
  badge text;
BEGIN
  IF NEW.duty NOT IN ('Day', 'Night') THEN
    RETURN NEW;
  END IF;
  new_side := NEW.duty::text;
  sid := NEW.staff_id;
  IF sid IS NULL AND NEW.staff_email IS NOT NULL THEN
    SELECT s.id INTO sid FROM public.staff s WHERE lower(s.email) = lower(NEW.staff_email) LIMIT 1;
  END IF;
  IF sid IS NULL THEN
    RETURN NEW;
  END IF;
  m_start := date_trunc('month', NEW.date)::date;

  SELECT * INTO existing FROM public.schedule_memberships
  WHERE staff_id = sid AND area = NEW.area AND month_start = m_start;

  IF FOUND THEN
    IF existing.side <> new_side THEN
      SELECT s.name, coalesce(s.badge_id, '') INTO who, badge FROM public.staff s WHERE s.id = sid;
      RAISE EXCEPTION '% (badge %) is already on the % % schedule for %. A staff member cannot be on both sides of the same area.',
        coalesce(who, 'This staff member'), badge, NEW.area, existing.side,
        to_char(m_start, 'FMMonth YYYY')
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  INSERT INTO public.schedule_memberships (staff_id, area, month_start, side)
  VALUES (sid, NEW.area, m_start, new_side);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shifts_sync_membership
  BEFORE INSERT OR UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.sync_schedule_membership();

-- Drop a membership once the last working shift for that staff/area/month is gone.
CREATE OR REPLACE FUNCTION public.cleanup_schedule_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid uuid;
  m_start date;
  remaining int;
BEGIN
  sid := OLD.staff_id;
  IF sid IS NULL AND OLD.staff_email IS NOT NULL THEN
    SELECT s.id INTO sid FROM public.staff s WHERE lower(s.email) = lower(OLD.staff_email) LIMIT 1;
  END IF;
  IF sid IS NULL THEN RETURN OLD; END IF;
  m_start := date_trunc('month', OLD.date)::date;
  SELECT count(*) INTO remaining FROM public.shifts sh
  WHERE sh.area = OLD.area
    AND sh.duty IN ('Day','Night')
    AND date_trunc('month', sh.date)::date = m_start
    AND (sh.staff_id = sid OR lower(sh.staff_email) = lower(OLD.staff_email));
  IF remaining = 0 THEN
    DELETE FROM public.schedule_memberships
    WHERE staff_id = sid AND area = OLD.area AND month_start = m_start;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_shifts_cleanup_membership
  AFTER DELETE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_schedule_membership();

-- Backfill from the schedule that already exists.
INSERT INTO public.schedule_memberships (staff_id, area, month_start, side)
SELECT DISTINCT ON (s.id, sh.area, date_trunc('month', sh.date)::date)
  s.id, sh.area, date_trunc('month', sh.date)::date, sh.duty::text
FROM public.shifts sh
JOIN public.staff s ON s.id = sh.staff_id OR lower(s.email) = lower(sh.staff_email)
WHERE sh.duty IN ('Day','Night')
ORDER BY s.id, sh.area, date_trunc('month', sh.date)::date, sh.date
ON CONFLICT DO NOTHING;