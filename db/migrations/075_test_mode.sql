-- 075_test_mode.sql — Test mode: nothing is sent to a real business while QA tests (26 Nov 2026).
--
-- app_settings  small app-wide settings by key. First key: 'test_mode' = { on, emails[], phones[], hosts[] }.
--               While on, every send point (emails, contact forms, AI calls, SMS) only reaches the listed test
--               contacts. Starts ON with only the app's own website (the RateUp test contact page) on the list;
--               the operator's test email / phone are added with web/scripts/test-mode.ts (kept out of git).
--
-- The app reads it fail-closed: until this is run, the app treats Test mode as ON with an empty list, so NOTHING is
-- sent. The app has no switch to turn it off; the operator asks (web/scripts/test-mode.ts --off).

create table if not exists app_settings (
    key         text primary key,
    value       jsonb not null default '{}'::jsonb,
    updated_at  timestamptz not null default now()
);
alter table if exists app_settings disable row level security;

insert into app_settings (key, value)
values ('test_mode', '{"on": true, "emails": [], "phones": [], "hosts": ["google-business-lead-gen-outreach.vercel.app"]}'::jsonb)
on conflict (key) do nothing;
