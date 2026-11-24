-- 068_automation.sql — running the outreach on its own (24 Nov 2026, workflow run_automation.md).
--
-- batches:           auto-start of the batch email 24 h after the batch finishes (batches.settings.auto_email = the
--                    choice; these columns = its state), and which daily-batch row made the batch.
-- call_campaigns:    contact_forms = a batch email also sends its offer through the contact form of leads with no email.
-- contact_form_runs: source = 'auto' for the automatic contact forms (10 a day are counted on these).
-- batch_schedules:   the Daily batches list (niche + city), one 100-lead batch each weekday within $40 a month.
-- Safe to run twice.

alter table batches add column if not exists auto_email_at          timestamptz;
alter table batches add column if not exists auto_email_state       text;
alter table batches drop constraint if exists batches_auto_email_state_check;
alter table batches add constraint batches_auto_email_state_check check (auto_email_state in ('waiting', 'cancelled', 'started', 'skipped'));
alter table batches add column if not exists auto_email_note        text;
alter table batches add column if not exists auto_email_campaign_id uuid references call_campaigns(id) on delete set null;
alter table batches add column if not exists schedule_id            uuid;
alter table batches add column if not exists scheduled_for          date;   -- New York date of a scheduled batch: one a day
create unique index if not exists batches_scheduled_for_key on batches (scheduled_for) where scheduled_for is not null;
create index if not exists batches_auto_email_idx on batches (auto_email_state, auto_email_at);

alter table call_campaigns add column if not exists contact_forms boolean not null default false;

alter table contact_form_runs add column if not exists source text not null default 'manual';
alter table contact_form_runs drop constraint if exists contact_form_runs_source_check;
alter table contact_form_runs add constraint contact_form_runs_source_check check (source in ('manual', 'auto'));
create index if not exists contact_form_runs_source_idx on contact_form_runs (source, created_at desc);

create table if not exists batch_schedules (
    id            uuid primary key default gen_random_uuid(),
    niche         text not null,
    city          text not null,
    country_code  text not null default 'us',
    active        boolean not null default true,
    last_run_at   timestamptz,
    last_batch_id uuid references batches(id) on delete set null,
    created_at    timestamptz not null default now()
);
alter table batch_schedules disable row level security;
