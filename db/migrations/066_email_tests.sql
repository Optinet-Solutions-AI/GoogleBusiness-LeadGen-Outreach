-- 066_email_tests.sql — wording tests: two versions of one offer's email, taking turns in Send email (24 Nov 2026).
--
-- Version A = the email used now for the offer ("service:<offer>" = its ready-made email, or "saved:<template id>");
-- version B = a saved template ("saved:<template id>"). While a test runs, Send email for that offer fills whichever
-- version has fewer sends. The operator ends it and keeps A or B (winner). One running test per offer.
-- Which version each email used is recorded on the send itself (outreach_events.meta.email_used), not here.
-- Code tolerates this table missing (the Templates page says to run 066). Safe to run twice.

create table if not exists email_tests (
    id           uuid primary key default gen_random_uuid(),
    service_key  text not null,                          -- the offer being tested (seo, website_build, …)
    a_key        text not null,                          -- version A: "service:<offer>" or "saved:<template id>"
    b_key        text not null,                          -- version B: "saved:<template id>"
    a_label      text not null,
    b_label      text not null,
    status       text not null default 'running' check (status in ('running', 'done')),
    winner       text check (winner in ('A', 'B')),      -- set when the operator ends the test
    started_at   timestamptz not null default now(),
    ended_at     timestamptz,
    created_at   timestamptz not null default now()
);

create unique index if not exists email_tests_one_running_per_offer on email_tests (service_key) where status = 'running';
create index if not exists email_tests_started_idx on email_tests (started_at desc);
