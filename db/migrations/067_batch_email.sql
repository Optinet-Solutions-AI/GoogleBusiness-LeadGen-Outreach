-- 067_batch_email.sql — "Email this batch" (24 Nov 2026): a batch campaign that sends Send email's offers.
--
-- A batch email is an email campaign (call_campaigns, channel 'email', batch_id set) whose leads each get the
-- ready-made email for their offer, or a saved template chosen per offer, written out in full at launch
-- (leads.seq_copy_overrides + seq_max_step, the same plan Send email follow-ups use). These columns record the
-- campaign's settings; the email scheduler reads the daily limit from each lead's plan, so a later change here
-- doesn't alter emails already planned. Safe to run twice.

alter table call_campaigns add column if not exists email_mode  text not null default 'classic';
alter table call_campaigns drop constraint if exists call_campaigns_email_mode_check;
alter table call_campaigns add constraint call_campaigns_email_mode_check check (email_mode in ('classic', 'offers'));
alter table call_campaigns add column if not exists daily_limit int check (daily_limit between 1 and 500);   -- first emails per 24 h
alter table call_campaigns add column if not exists follow_ups  int not null default 0 check (follow_ups between 0 and 2);
alter table call_campaigns add column if not exists include_eu  boolean not null default false;  -- EU / EEA / UK leads (GDPR rule)
alter table call_campaigns add column if not exists email_choice jsonb not null default '{}'::jsonb; -- offer → "auto" | "saved:<id>"
