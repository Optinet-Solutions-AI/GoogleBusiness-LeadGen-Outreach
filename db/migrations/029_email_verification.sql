-- 029_email_verification.sql
-- Email verification verdicts + a per-domain intel cache (catch-all/MX/provider).
-- House style: idempotent; RLS disabled (prod reads with a key subject to RLS).

create table if not exists domain_email_intel (
    domain        text primary key,
    mx_top        text,
    provider_type text,             -- google_workspace | outlook365 | cpanel_or_other
    is_catch_all  boolean,
    checked_at    timestamptz not null default now()
);
alter table if exists domain_email_intel disable row level security;

alter table if exists leads add column if not exists verification_status text;  -- valid|invalid|catch-all|unknown|null
alter table if exists leads add column if not exists email_verified boolean not null default false;
alter table if exists leads add column if not exists verified_at timestamptz;
alter table if exists leads add column if not exists verify_syntax_ok boolean;
alter table if exists leads add column if not exists verify_mx_ok boolean;
alter table if exists leads add column if not exists verify_smtp_result text;
alter table if exists leads add column if not exists verify_zerobounce_result text;
alter table if exists leads add column if not exists verify_millionverifier_result text;
alter table if exists leads add column if not exists verify_hunter_result text;
create index if not exists leads_verification_status_idx on leads (verification_status);
