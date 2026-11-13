-- 060_followups_test_numbers.sql — follow-ups from the Send email window + a test number for AI calls.
--
-- leads.seq_max_step: set when the operator writes the follow-ups themselves in Send email (the first email
--   is sent right away, the follow-ups go out 4 days apart from leads.seq_copy_overrides). Its value is the
--   number of emails in total (2 = first email + 1 follow-up). Null = the classic screenshot sequence, where
--   the number of steps comes from the lead's segment.
-- campaign_leads.call_phone: a number typed in the Call with AI window (e.g. your own, to test the agent).
--   Only that queued call dials it; the lead's saved phone is untouched. Null = dial the lead's own number.
-- Additive + idempotent. Run in the Supabase SQL editor.

alter table leads add column if not exists seq_max_step int;
alter table campaign_leads add column if not exists call_phone text;
