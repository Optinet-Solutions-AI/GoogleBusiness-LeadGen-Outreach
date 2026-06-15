-- 033_lead_website_status.sql
-- Stores the auditor's final reachability status string for an existing website,
-- e.g. "200", "404", "403 blocked", "timeout", "dns_error". null = not audited.
-- Lets the operator see WHY a lead was/wasn't tagged improve_website, and keeps
-- "couldn't verify" (blocked/timeout) distinct from "dead" (404/5xx/dns).
alter table leads add column if not exists website_status text;
