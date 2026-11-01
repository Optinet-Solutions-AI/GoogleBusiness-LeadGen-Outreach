-- 052_lead_contact_page.sql — the lead's own contact page, found while crawling its website.
--
-- Filled at scrape time by lib/services/website-email.ts (any wording: "Get in touch", "Kuntatt"…).
-- Additive + idempotent. Run in the Supabase SQL editor.
alter table leads add column if not exists contact_page_url text;
