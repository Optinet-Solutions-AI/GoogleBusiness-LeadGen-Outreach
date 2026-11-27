-- 078_reply_ai.sql — AI reply handling (27 Nov 2026): each human reply's category, summary and draft answer.
--
-- The inbox reader marks a new human reply ai_state 'pending'; the inbox tick (Cloud Run MODE=inbox) asks OpenAI to
-- sort it and write a draft a person sends from the Inbox (never sent by the AI). 3 tries, then 'failed'.
-- leads.reply_category = the latest reply's category (Inbox order, the Brain); leads.last_reply_at = when it came.
-- Without these columns replies are stored exactly as before. workflows/handle_replies_with_ai.md.
alter table email_messages add column if not exists ai_state text check (ai_state in ('pending', 'done', 'failed'));
alter table email_messages add column if not exists ai_category text;
alter table email_messages add column if not exists ai_summary text;
alter table email_messages add column if not exists ai_draft_body text;
alter table email_messages add column if not exists ai_referral jsonb;
alter table email_messages add column if not exists ai_at timestamptz;
alter table email_messages add column if not exists ai_usd numeric;
alter table email_messages add column if not exists ai_error text;
alter table email_messages add column if not exists ai_attempts int not null default 0;
create index if not exists email_messages_ai_pending_idx on email_messages (created_at) where ai_state = 'pending';
alter table leads add column if not exists reply_category text;
alter table leads add column if not exists last_reply_at timestamptz;
