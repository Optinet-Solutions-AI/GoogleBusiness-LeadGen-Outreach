-- 028_social_accounts.sql
-- The dedicated social handle(s) the team DMs leads from (shared org-wide).
-- Meta blocks automated cold DMs, so this is reference/config for the assisted-DM
-- worklist — it records WHICH account everyone sends from, not an integration.
--
-- House style: idempotent (create if not exists), RLS disabled (the app reads with
-- the service-role key; prod must not get filtered to 0 rows).

create table if not exists social_accounts (
    id           uuid primary key default uuid_generate_v4(),
    platform     text not null default 'instagram'   -- instagram | facebook | tiktok | other
                 check (platform in ('instagram','facebook','tiktok','linkedin','twitter','other')),
    handle       text not null,                        -- e.g. @youragency
    profile_url  text,                                 -- link opened to start a DM
    label        text,                                 -- optional note ("main brand account")
    status       text not null default 'active'
                 check (status in ('active','paused')),
    created_at   timestamptz not null default now()
);

create index if not exists social_accounts_status_idx on social_accounts (status, created_at desc);

alter table if exists social_accounts disable row level security;
