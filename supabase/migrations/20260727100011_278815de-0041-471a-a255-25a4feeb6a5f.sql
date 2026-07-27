CREATE POLICY "cancel own pending leave" ON public.leave_requests
FOR UPDATE TO authenticated
USING (lower(staff_email) = current_email() AND status = 'Pending'::leave_status)
WITH CHECK (lower(staff_email) = current_email());