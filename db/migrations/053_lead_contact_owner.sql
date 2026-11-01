-- 053_lead_contact_owner.sql — who runs the business and where its contact details were found.
--
-- Filled by the OpenAI contact finder (lib/services/openai-contacts.ts) for leads the free site crawl left
-- without an email: the owner / director as publicly listed, and the pages the answers came from.
-- Additive + idempotent. Run in the Supabase SQL editor.
alter table leads add column if not exists contact_owner_name text;
alter table leads add column if not exists contact_owner_role text;
alter table leads add column if not exists contact_sources jsonb;
