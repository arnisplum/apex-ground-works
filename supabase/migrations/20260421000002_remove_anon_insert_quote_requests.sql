-- Remove anonymous INSERT on quote_requests; submissions go through Edge Function (service role) only.
-- Apply after submit-smart-quote is deployed and tested.

drop policy if exists "Anon insert quote_requests" on public.quote_requests;
