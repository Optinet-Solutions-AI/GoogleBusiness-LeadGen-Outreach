-- 080_link_checks.sql — does a lead's contact page actually open? (27 Nov 2026, from the Explee walkthrough).
--
-- link_checks = { contact_page: { url, state: ok | dead | unknown | unchecked, at } }, written during scraping by one
-- quick request (free, lib/services/link-check.ts). Only a missing page (404 / 410) or an address that doesn't exist is
-- "dead"; a block or a timeout is "unknown". Social pages (LinkedIn, Facebook…) are never fetched: they block automated
-- checks and we never get around that. The Contact card shows a note under a link that doesn't open.
-- Without this column scraping saves everything else as before.
alter table leads add column if not exists link_checks jsonb;
