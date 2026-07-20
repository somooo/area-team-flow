
CREATE TYPE public.duty_type AS ENUM ('Day','Night','Off','Vacation','Sick','Paternity');
CREATE TYPE public.ot_type AS ENUM ('None','BuiltIn','Additional','MedEvac');

ALTER TABLE public.shifts
  ADD COLUMN unit_code text,
  ADD COLUMN duty public.duty_type,
  ADD COLUMN ot_type public.ot_type NOT NULL DEFAULT 'None';

UPDATE public.shifts SET duty = CASE
  WHEN shift_type = 'Morning' THEN 'Day'::public.duty_type
  WHEN shift_type = 'Evening' THEN 'Day'::public.duty_type
  WHEN shift_type = 'Night' THEN 'Night'::public.duty_type
  WHEN shift_type = 'Off' THEN 'Off'::public.duty_type
END;

ALTER TABLE public.shifts ALTER COLUMN duty SET NOT NULL;
ALTER TABLE public.shifts ALTER COLUMN duty SET DEFAULT 'Day';
