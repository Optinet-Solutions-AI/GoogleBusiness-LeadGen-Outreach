-- 027_campaign_sender_email.sql
-- Remember which connected mailbox an email campaign sends from (chosen in the
-- New-campaign wizard's Sender picker). Launch + test-send still accept an
-- override; this is the stored default. Idempotent.

alter table if exists call_campaigns add column if not exists sender_email text;
