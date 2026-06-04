-- 026_campaign_lead_sent_status.sql
-- Allow campaign_leads.status = 'sent' so the email-campaign Launch can mark a
-- member as sent (the launch route writes 'sent'; the old check rejected it).
-- Idempotent: drop the existing status check + re-add with 'sent' included.

alter table if exists campaign_leads drop constraint if exists campaign_leads_status_check;
alter table if exists campaign_leads
  add constraint campaign_leads_status_check
  check (status in ('pending', 'called', 'interested', 'done', 'skipped', 'sent'));
