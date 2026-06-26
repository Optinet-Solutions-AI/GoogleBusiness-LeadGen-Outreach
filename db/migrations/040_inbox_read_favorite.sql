-- 040_inbox_read_favorite.sql — Gmail-like inbox: read state + favorites.
--
-- inbox_read_at: null = unread (bold in the list); set = read.
-- is_favorite:   operator-starred thread.
-- Archive/snooze reuse leads.inbox_status ('closed'/'snoozed'); do-not-contact
-- reuses leads.lifecycle_stage = 'dnc'. No new tables — one thread per lead.

alter table leads add column if not exists inbox_read_at timestamptz;
alter table leads add column if not exists is_favorite boolean not null default false;

-- Fast filters for the inbox views.
create index if not exists idx_leads_is_favorite on leads (is_favorite) where is_favorite = true;
create index if not exists idx_leads_inbox_read_at on leads (inbox_read_at);
