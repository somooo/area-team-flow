GRANT DELETE ON public.vacation_change_requests TO authenticated;
CREATE POLICY "withdraw own pending change request"
ON public.vacation_change_requests FOR DELETE TO authenticated
USING (lower(requested_by) = public.current_email() AND status = 'pending');