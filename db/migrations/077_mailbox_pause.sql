-- 077_mailbox_pause.sql — mailbox auto-pause (27 Nov 2026): why and when a mailbox was paused, and when it was resumed.
--
-- The automation tick (every 15 minutes) pauses an active mailbox whose hard bounces or spam complaints climbed
-- (status 'paused', paused_by 'auto'). It stays paused until the operator presses Resume on Email accounts, which
-- stamps resumed_at: the health window then starts again from that moment. workflows/watch_mailbox_health.md.
-- Without these columns the check does nothing (it says so in the tick summary).
alter table email_accounts add column if not exists paused_reason text;
alter table email_accounts add column if not exists paused_at timestamptz;
alter table email_accounts add column if not exists paused_by text check (paused_by in ('auto', 'operator'));
alter table email_accounts add column if not exists resumed_at timestamptz;
