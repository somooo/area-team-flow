ALTER TYPE public.leave_status ADD VALUE IF NOT EXISTS 'Cancelled';
ALTER TABLE public.vacation_change_requests ADD COLUMN IF NOT EXISTS decision_reason text;