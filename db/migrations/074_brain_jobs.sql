-- 074_brain_jobs.sql — the Brain: jobs given in plain words, and the plan it makes per lead (26 Nov 2026).
--
-- brain_jobs       one job ("get me 100 plumbers in Texas and work them"): what was understood, the operator's
--                  settings (budget, channels, per-day numbers), its batch, what it has spent, where it stands.
-- brain_job_leads  one row per lead of the job: the decision (contact / skip, offer, channels, why), what the operator
--                  approved, and how far the automatic steps got (first touch, contact form, call, outcome).
-- batches.brain_job_id     the job that started this search.
-- contact_form_runs.source adds 'brain' (a contact form sent by a job; counted per job, not in the automatic 10 a day).
--
-- Code tolerates this migration missing: the Brain page says to run it. Workflow: workflows/run_brain_job.md.

create table if not exists brain_jobs (
    id                 uuid primary key default uuid_generate_v4(),
    command            text not null,
    intent             text not null check (intent in ('find_and_work', 'work_batch')),
    status             text not null default 'asking'
                       check (status in ('asking','searching','planning','review','running','paused','done','cancelled','failed')),
    ask                jsonb not null default '{}'::jsonb,
    settings           jsonb not null default '{}'::jsonb,
    batch_id           uuid references batches(id) on delete set null,
    email_campaign_id  uuid,
    spent_usd          numeric(10,4) not null default 0,
    notice             text,
    approved_at        timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);
create index if not exists brain_jobs_status_idx on brain_jobs (status, created_at desc);
create index if not exists brain_jobs_batch_idx on brain_jobs (batch_id);
alter table if exists brain_jobs disable row level security;

create table if not exists brain_job_leads (
    job_id            uuid not null references brain_jobs(id) on delete cascade,
    lead_id           uuid not null references leads(id) on delete cascade,
    decision          text not null check (decision in ('contact', 'skip')),
    offer             text,
    channels          text[] not null default '{}',
    allowed_offers    text[] not null default '{}',
    allowed_channels  text[] not null default '{}',
    reason            text,
    source            text not null check (source in ('ai', 'rule', 'default')),
    approved          boolean not null default false,
    first_touch_at    timestamptz,
    form_state        text,          -- pending | sending | sent | needs_person | failed | skipped
    call_due_at       timestamptz,
    call_state        text,          -- pending | queued | skipped
    outcome           text,          -- win | stopped | done
    outcome_reason    text,
    updated_at        timestamptz not null default now(),
    primary key (job_id, lead_id)
);
create index if not exists brain_job_leads_lead_idx on brain_job_leads (lead_id);
alter table if exists brain_job_leads disable row level security;

alter table batches add column if not exists brain_job_id uuid;

alter table contact_form_runs drop constraint if exists contact_form_runs_source_check;
alter table contact_form_runs add constraint contact_form_runs_source_check check (source in ('manual', 'auto', 'brain'));
