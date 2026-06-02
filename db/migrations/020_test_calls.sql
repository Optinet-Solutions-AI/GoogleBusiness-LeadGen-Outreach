-- 020_test_calls.sql — persist in-browser test calls (transcript + recording) in the app.
--
-- Stores each /test-call conversation server-side so the whole team can review them inside the
-- app, instead of a one-off .txt download stuck on one laptop.
--
-- Additive + idempotent. Apply with:
--   psql "$SUPABASE_URL" -f db/migrations/020_test_calls.sql   (run by the operator)

create table if not exists test_calls (
    id               uuid primary key default uuid_generate_v4(),
    vapi_call_id     text,                          -- Vapi web-call id (for re-fetching the recording)
    agent_id         text,                          -- which assistant was tested
    transcript       jsonb not null default '[]',   -- [{ role: 'assistant'|'user', text }]
    recording_url    text,
    summary          text,
    duration_seconds int,
    created_at       timestamptz not null default now()
);
create index if not exists test_calls_created_at_idx on test_calls(created_at desc);
alter table if exists test_calls disable row level security;
