-- 1) Assignment codes
CREATE TABLE public.assignment_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area text NOT NULL,
  layer text NOT NULL DEFAULT 'all',
  code text NOT NULL,
  unit text,
  duty duty_type NOT NULL DEFAULT 'Day',
  unit_code text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (area, layer, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignment_codes TO authenticated;
GRANT ALL ON public.assignment_codes TO service_role;
ALTER TABLE public.assignment_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read assignment codes" ON public.assignment_codes FOR SELECT TO authenticated USING (true);
CREATE POLICY "managers write assignment codes" ON public.assignment_codes FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_supervisor_of(area))
  WITH CHECK (public.is_admin() OR public.is_supervisor_of(area));
CREATE TRIGGER trg_assignment_codes_updated BEFORE UPDATE ON public.assignment_codes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Zone / pager reference
CREATE TABLE public.zone_reference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area text NOT NULL,
  zone text,
  unit text,
  assignment_no text,
  label text,
  pager text,
  extension text,
  role text,
  coverage_weekday text,
  coverage_weekend text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zone_reference TO authenticated;
GRANT ALL ON public.zone_reference TO service_role;
ALTER TABLE public.zone_reference ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read zone reference" ON public.zone_reference FOR SELECT TO authenticated USING (true);
CREATE POLICY "managers write zone reference" ON public.zone_reference FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_supervisor_of(area))
  WITH CHECK (public.is_admin() OR public.is_supervisor_of(area));
CREATE TRIGGER trg_zone_reference_updated BEFORE UPDATE ON public.zone_reference
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Team leader reports
CREATE TABLE public.team_leader_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_email text NOT NULL,
  reporter_name text NOT NULL,
  area text NOT NULL,
  layer text NOT NULL DEFAULT 'day',
  shift_date date NOT NULL,
  assignment_code text,
  sick_calls jsonb NOT NULL DEFAULT '[]'::jsonb,
  comment text,
  approver_email text,
  status text NOT NULL DEFAULT 'Submitted',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.team_leader_reports TO authenticated;
GRANT ALL ON public.team_leader_reports TO service_role;
ALTER TABLE public.team_leader_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "insert own tl report" ON public.team_leader_reports FOR INSERT TO authenticated
  WITH CHECK (lower(reporter_email) = public.current_email());
CREATE POLICY "read tl reports" ON public.team_leader_reports FOR SELECT TO authenticated
  USING (lower(reporter_email) = public.current_email() OR public.is_admin() OR public.is_area_manager_of(area));
CREATE POLICY "managers update tl reports" ON public.team_leader_reports FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.is_area_manager_of(area))
  WITH CHECK (public.is_admin() OR public.is_area_manager_of(area));
CREATE TRIGGER trg_tl_reports_updated BEFORE UPDATE ON public.team_leader_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed: ICU assignment codes
INSERT INTO public.assignment_codes (area, layer, code, unit, duty, unit_code, sort_order) VALUES
('ICU','day','D5','Cardiac','Day','5',10),
('ICU','day','D6','Cardiac','Day','6',11),
('ICU','day','D12','Cardiac','Day','12',12),
('ICU','day','D17','Cardiac','Day','17',13),
('ICU','day','D27','Cardiac','Day','27',14),
('ICU','day','D15','GICU','Day','15',20),
('ICU','day','D10','GICU','Day','10',21),
('ICU','day','D18','PRU','Day','18',30),
('ICU','day','D19','PRU','Day','19',31),
('ICU','day','D22','NCCU','Day','22',40),
('ICU','day','D35','RICU','Day','35',50),
('ICU','day','D36','RICU','Day','36',51),
('ICU','day','D37','RICU','Day','37',52),
('ICU','day','D8','ER','Day','8',60),
('ICU','day','D13','CCRT','Day','13',70),
('ICU','day','D9','MICU','Day','9',80),
('ICU','day','D2','MICU','Day','2',81),
('ICU','day','D3','MICU','Day','3',82),
('ICU','day','D7','MICU','Day','7',83),
('ICU','day','D33','TICU','Day','33',90),
('ICU','day','D30','SICU/BURN','Day','30',100),
('ICU','day','D31','SICU/BURN','Day','31',101),
('ICU','night','N5','Cardiac','Night','5',10),
('ICU','night','N6','Cardiac','Night','6',11),
('ICU','night','N12','Cardiac','Night','12',12),
('ICU','night','N17','Cardiac','Night','17',13),
('ICU','night','N27','Cardiac','Night','27',14),
('ICU','night','N15','GICU','Night','15',20),
('ICU','night','N10','GICU','Night','10',21),
('ICU','night','N18','PRU','Night','18',30),
('ICU','night','N19','PRU','Night','19',31),
('ICU','night','N22','NCCU','Night','22',40),
('ICU','night','N35','RICU','Night','35',50),
('ICU','night','N36','RICU','Night','36',51),
('ICU','night','N37','RICU','Night','37',52),
('ICU','night','N8','ER','Night','8',60),
('ICU','night','N13','CCRT','Night','13',70),
('ICU','night','N9','MICU','Night','9',80),
('ICU','night','N2','MICU','Night','2',81),
('ICU','night','N3','MICU','Night','3',82),
('ICU','night','N7','MICU','Night','7',83),
('ICU','night','N33','TICU','Night','33',90),
('ICU','night','N30','SICU/BURN','Night','30',100),
('ICU','night','N31','SICU/BURN','Night','31',101);

-- Seed: Wards assignment codes (same codes for day and night)
INSERT INTO public.assignment_codes (area, layer, code, unit, duty, unit_code, sort_order)
SELECT 'Wards', l.layer, c.code, c.unit,
       (CASE WHEN l.layer = 'night' THEN 'Night' ELSE 'Day' END)::duty_type, c.code, c.ord
FROM (VALUES ('day'),('night')) AS l(layer)
CROSS JOIN (VALUES
  ('A1','Zone A',10),('A2','Zone A',11),('A3','Zone A',12),('A4','Zone A',13),('A5','Zone A',14),('A6','Zone A',15),
  ('B1','Zone B',20),('B2','Zone B',21),('B3','Zone B',22),('B4','Zone B',23),('B5','Zone B',24),('B6','Zone B',25),('B7','Zone B',26),
  ('C1','Zone C',30),('C2','Zone C',31),('C3','Zone C',32),
  ('D1','Zone D',40),('D2','Zone D',41),
  ('E1','ER',50),('E2','ER',51)
) AS c(code, unit, ord);

-- Seed: Assistants assignment codes
INSERT INTO public.assignment_codes (area, layer, code, unit, duty, unit_code, sort_order) VALUES
('Assistants','all','C','Cardiac + W18-25','Day','C',10),
('Assistants','all','G','Surgical + ER','Day','G',20),
('Assistants','all','I','ICU + TICU + NCCU','Day','I',30),
('Assistants','all','Y','Oxygen + W15-16','Day','Y',40),
('Assistants','all','D','Office + MRI','Day','D',50),
('Assistants','all','A','GICU + RICU + PRU','Day','A',60);

-- Seed: ICU zone reference
INSERT INTO public.zone_reference (area, zone, unit, assignment_no, label, pager, extension, sort_order) VALUES
('ICU','Zone I','PCICU I,II','5','WIFI 16024','','16955',10),
('ICU','Zone I','PCICU I,II','12','','4607','16955',11),
('ICU','Zone I','PCICU I,II','27','','3191','16955',12),
('ICU','Zone I','CTS & TICU','6','','7362','16955',13),
('ICU','Zone I','CTS & TICU','11','','4468','16955',14),
('ICU','Zone I','MCICU','17','','4609','16955',15),
('ICU','Zone II','GICU','10','','3596','12152',20),
('ICU','Zone II','GICU','15','','2152','12152',21),
('ICU','Zone II','PRU','18','','3221','19550',22),
('ICU','Zone II','PRU','19','','3196','19550',23),
('ICU','Zone II','Neuro ICU','22','','5239','14418',24),
('ICU','Zone II','RICU','35','TL','7474','12322',25),
('ICU','Zone II','RICU','WiFi','','13152','12322',26),
('ICU','Zone II','RICU','36','','1413','12322',27),
('ICU','Zone II','RICU','37','','','12322',28),
('ICU','Zone III','MICU','2','','7374','18826',30),
('ICU','Zone III','MICU','3','','7369','18826',31),
('ICU','Zone III','MICU','7','','5515','18826',32),
('ICU','Zone III','MICU','9','','7703','18826',33),
('ICU','Zone III','TICU','33','','5056','18826',34),
('ICU','Zone III','TICU','34','','4361','18826',35),
('ICU','Zone III','CCRT','13','','5508','19805',36),
('ICU','Zone III','ER','8','','0017','19805',37),
('ICU','Zone IV','Burn','30','','8533','15048',40),
('ICU','Zone IV','SICU','31','','5236','15048',41);

-- Seed: Wards zone reference
INSERT INTO public.zone_reference (area, zone, assignment_no, pager, unit, role, sort_order) VALUES
('Wards','Zone A','A1','7357','W18–W25','Charge + zone leader',10),
('Wards','Zone A','A2','7372','W18–W25','',11),
('Wards','Zone A','A3','3174','W18–W25','',12),
('Wards','Zone A','A4','3195','W18–W25','',13),
('Wards','Zone A','A5','7383','W18–W25','',14),
('Wards','Zone A','A6','6279','W18–W25','',15),
('Wards','Zone B','B1','7707','W7–10, W12, W15, W16a/b, HEMO, W4–5','Zone leader + CODE',20),
('Wards','Zone B','B2','3170','W7–10, W12, W15, W16a/b, HEMO, W4–5','',21),
('Wards','Zone B','B3','7366','W7–10, W12, W15, W16a/b, HEMO, W4–5','',22),
('Wards','Zone B','B4','4365','W7–10, W12, W15, W16a/b, HEMO, W4–5','',23),
('Wards','Zone B','B5','7364','W7–10, W12, W15, W16a/b, HEMO, W4–5','',24),
('Wards','Zone B','B6','3192','W7–10, W12, W15, W16a/b, HEMO, W4–5','',25),
('Wards','Zone C','C1','7379','W29–34, CCU, PCSD','Zone leader + CODE',30),
('Wards','Zone C','C2','4608','W29–34, CCU, PCSD','',31),
('Wards','Zone C','C3','3192','W29–34, CCU, PCSD','',32),
('Wards','Zone D','D1','6792','W36–40, W16c','Zone leader + CODE',40),
('Wards','Zone D','D2','7731','W36–40, W16c','',41),
('Wards','ER','E1','7378','ACUA, ACUB, ADCU, CDU, ASU, RAM1, RAM2','',50),
('Wards','ER','E2','2745','FLU UNIT, FAST TRACK','',51);

-- Seed: Assistants reference
INSERT INTO public.zone_reference (area, assignment_no, pager, coverage_weekday, coverage_weekend, sort_order) VALUES
('Assistants','C','4458','Cardiac + W18–25','Cardiac + W18–25',10),
('Assistants','G','4364','Surgical + ER + FLUE + M-Xray + W4–5 + New Angio','Surgical + ER + FLUE + M-Xray + W4–5 + New Angio',20),
('Assistants','I','7380','ICU + TICU + NCCU + OR + CT + Old Angio','ICU + TICU + NCCU + OR + CT + Old Angio',30),
('Assistants','Y','7365','Oxygen + W15–16 + Dental + ACC','Oxygen + W15–16 + Dental + ACC + MRI + Dialysis',40),
('Assistants','D','3193','Office + MRI + Dialysis + W12 + Dept','OFF',50),
('Assistants','A','1913','GICU + RICU + PRU + W7–10','GICU + RICU + PRU + W7–10 + W12 + Dept',60);
