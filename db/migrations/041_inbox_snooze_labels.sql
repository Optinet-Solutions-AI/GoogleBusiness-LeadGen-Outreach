-- 041_inbox_snooze_labels.sql — Gmail-like inbox Phase 2: snooze + labels.
--
-- inbox_snooze_until: when set (and inbox_status='snoozed'), the thread is hidden
--   until this time, then re-surfaces in the inbox.
-- inbox_labels: operator-defined tags on a thread (free-form text array).

alter table leads add column if not exists inbox_snooze_until timestamptz;
alter table leads add column if not exists inbox_labels text[] not null default '{}';

create index if not exists idx_leads_inbox_snooze_until on leads (inbox_snooze_until);
create index if not exists idx_leads_inbox_labels on leads using gin (inbox_labels);
