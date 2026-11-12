-- 059_outreach_previews.sql — what the operator approved in the Send email / Call with AI previews.
--
-- leads.seq_copy_overrides: the email wording the operator saw (and maybe edited) in the Send email preview,
--   keyed by sequence step ("1" = the first email): {"1": {"subject": "...", "body": "..."}}. Sent exactly as
--   approved (no auto-translation). Set on enroll; any enroll without a preview clears it.
-- campaign_leads.call_name: the first name the Voizo AI agent greets this lead by (sent as `name` on the dial).
--   Null = the agent uses no name.
-- Additive + idempotent. Run in the Supabase SQL editor.

alter table leads add column if not exists seq_copy_overrides jsonb;
alter table campaign_leads add column if not exists call_name text;
