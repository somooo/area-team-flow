ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS cover_decline_reason text,
  ADD COLUMN IF NOT EXISTS cover_accepted_at timestamptz;