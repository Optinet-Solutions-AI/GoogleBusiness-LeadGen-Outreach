-- 071_test_form.sql — messages sent to the RateUp test contact form (25 Nov 2026).
--
-- /test-form is a plain contact page inside the app, so the AI contact-form sender (and QA) can be tested without
-- touching a real business: point a test lead's website + contact page at it. /test-form/received lists what came in.

create table if not exists test_form_messages (
    id          uuid primary key default gen_random_uuid(),
    name        text not null default '',
    email       text not null default '',
    phone       text not null default '',
    subject     text not null default '',
    message     text not null default '',
    created_at  timestamptz not null default now()
);
create index if not exists test_form_messages_created_idx on test_form_messages(created_at desc);
