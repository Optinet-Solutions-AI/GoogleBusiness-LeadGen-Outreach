-- 037_campaign_sender_emails.sql
-- Multi-sender campaigns: a campaign can rotate across several mailboxes.
-- sender_emails is the pool; the existing single sender_email is kept as a
-- back-compat fallback (treated as a one-element pool when sender_emails is null).
-- The scheduler assigns one pool member per lead at first send and pins it to
-- leads.seq_sender_email, so follow-ups never switch address.

alter table call_campaigns add column if not exists sender_emails text[];

update call_campaigns
set sender_emails = array[sender_email]
where sender_email is not null and sender_emails is null;
