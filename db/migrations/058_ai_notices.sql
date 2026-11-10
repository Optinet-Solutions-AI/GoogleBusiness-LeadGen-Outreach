-- 058_ai_notices.sql — let operators see when AI research was unavailable.
--
-- batches.notices: plain-English warnings about how a batch ran (e.g. "AI research was off — OpenAI key expired;
--   leads were looked up with the free website crawl only"). Shown on the batch page. Array of {level, text}.
-- service_health: the last real outcome per external service ('openai'), so a banner can say "out of credit"
--   (only a real call reveals that). Written by lib/services/openai-health.ts.
-- Additive + idempotent. Run in the Supabase SQL editor.

alter table batches add column if not exists notices jsonb not null default '[]'::jsonb;

create table if not exists service_health (
    service     text primary key,           -- 'openai'
    ok          boolean not null,
    code        text,                       -- ok | missing | key_invalid | no_credit | unreachable
    message     text,                       -- which feature recorded it (e.g. 'contact-finder')
    updated_at  timestamptz not null default now()
);
