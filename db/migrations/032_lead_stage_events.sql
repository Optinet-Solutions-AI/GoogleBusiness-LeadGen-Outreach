-- 032_lead_stage_events.sql
-- Per-stage transition log so reporting KPIs (meetings booked, deals closed)
-- can be dated exactly within a date-range, instead of leaning on
-- leads.updated_at as a proxy. One row per stage change.
-- House style: idempotent; RLS disabled.

create table if not exists lead_stage_events (
    id          uuid primary key default gen_random_uuid(),
    lead_id     uuid not null references leads(id),
    from_stage  text,
    to_stage    text not null,
    created_at  timestamptz not null default now()
);
alter table if exists lead_stage_events disable row level security;
create index if not exists lead_stage_events_lead_idx on lead_stage_events (lead_id, created_at);
create index if not exists lead_stage_events_stage_idx on lead_stage_events (to_stage, created_at);
