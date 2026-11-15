-- 062_other_contacts.sql — keep every email / phone we know for a lead, not just the main one.
--
-- leads.other_emails / leads.other_phones: the lead's extra addresses / numbers, newest first, as
--   [{"value": "...", "source": "replaced" | "research", "added_at": "<iso>"}]. When the operator verifies an email
--   or phone from "Research business", it becomes the main one (leads.email / leads.phone) and the previous main one
--   moves here instead of being deleted. The Contact card lists them under "More emails / phones" with "Use this".
-- Additive + idempotent. Run in the Supabase SQL editor.

alter table leads add column if not exists other_emails jsonb;
alter table leads add column if not exists other_phones jsonb;
