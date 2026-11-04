-- 055_creative_videos.sql — Reels rendered from a month's approved posts (Creative Studio video, Remotion).
--
-- One row per render request. The Cloud Run job (MODE=reel REEL_ID=<id>) claims it, renders the MP4,
-- uploads it to the client-assets bucket and marks it ready. Additive + idempotent. Run in the Supabase SQL editor.
create table if not exists creative_videos (
    id            uuid primary key default gen_random_uuid(),
    client_id     uuid not null references clients(id) on delete cascade,
    month         date not null,                                   -- first day of the month the posts belong to
    creative_ids  uuid[] not null default '{}',                    -- the posts used, in order
    settings      jsonb not null default '{}'::jsonb,              -- { slide_sec, fade_sec, title }
    status        text not null default 'queued'
                  check (status in ('queued','rendering','ready','failed')),
    started_at    timestamptz,
    finished_at   timestamptz,
    duration_sec  numeric,
    storage_path  text,
    public_url    text,
    bytes         bigint,
    last_error    text,
    created_at    timestamptz not null default now()
);
alter table if exists creative_videos disable row level security;
create index if not exists creative_videos_client_month_idx on creative_videos (client_id, month, created_at desc);
