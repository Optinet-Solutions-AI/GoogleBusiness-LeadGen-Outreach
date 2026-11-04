-- 054_crm.sql — CRM board fields: tags, next follow-up, owner, and append-only notes per lead.
--
-- Used by the /crm board (workflows/manage_crm.md). Additive + idempotent. Run in the Supabase SQL editor.
alter table leads add column if not exists tags               text[] not null default '{}';
alter table leads add column if not exists next_follow_up_at  timestamptz;
alter table leads add column if not exists assigned_to        text;

create index if not exists leads_next_follow_up_idx on leads (next_follow_up_at) where next_follow_up_at is not null;

create table if not exists lead_notes (
    id          uuid primary key default gen_random_uuid(),
    lead_id     uuid not null references leads(id) on delete cascade,
    body        text not null,
    author      text,
    created_at  timestamptz not null default now()
);
alter table if exists lead_notes disable row level security;
create index if not exists lead_notes_lead_idx on lead_notes (lead_id, created_at desc);
