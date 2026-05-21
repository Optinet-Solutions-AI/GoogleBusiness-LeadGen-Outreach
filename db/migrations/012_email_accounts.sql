-- 012_email_accounts.sql — Add email_accounts table for direct SMTP/IMAP mailboxes.
-- Apply: psql "$SUPABASE_URL" -f db/migrations/012_email_accounts.sql

create table if not exists email_accounts (
    id                  uuid primary key default uuid_generate_v4(),
    email               text unique not null,
    from_name           text,
    provider            text,
    auth_type           text,
    email_provider      text,
    smtp_host           text,
    smtp_port           int,
    smtp_user           text,
    smtp_password       text,
    smtp_secure         text check (smtp_secure in ('ssl', 'tls')),
    imap_host           text,
    imap_port           int,
    imap_user           text,
    imap_pass           text,
    status              text not null default 'active'
                        check (status in ('active', 'paused', 'error')),
    daily_cap           int,
    hourly_cap          int,
    is_cold_sender      bool not null default true,
    warmup_enabled      bool not null default true,
    warmup_started_at   timestamptz,
    warmup_target_cap   int not null default 50,
    warmup_ramp_days    int not null default 21,
    created_at          timestamptz not null default now()
);

alter table if exists email_accounts disable row level security;
