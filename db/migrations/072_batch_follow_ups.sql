-- 072_batch_follow_ups.sql — a batch email may schedule 3 follow-ups (day 4, 8, 12), not just 2 (25 Nov 2026).
--
-- Migration 067 limited call_campaigns.follow_ups to 0–2; "Email this batch" now offers 3. Postgres named the inline
-- check call_campaigns_follow_ups_check.

alter table call_campaigns drop constraint if exists call_campaigns_follow_ups_check;
alter table call_campaigns add constraint call_campaigns_follow_ups_check check (follow_ups between 0 and 3);
