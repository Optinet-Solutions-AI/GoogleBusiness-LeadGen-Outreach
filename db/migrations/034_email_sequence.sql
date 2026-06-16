-- 034_email_sequence.sql
-- Screenshot-first cold-email sequence: per-lead state for the 4-step
-- progressive-trust ladder (Day 0 plain text -> Day 4 screenshot -> Day 8 link
-- -> Day 12 close, every step 4 days apart) plus the demo-site screenshot we
-- embed inline from step 2 on. Reuses leads + outreach_events; no separate
-- campaign subsystem.

-- Demo-site screenshot, hosted on the lead's Pages project and embedded inline
-- (CID) in emails 2-4. null = not captured yet.
alter table leads add column if not exists screenshot_url text;
alter table leads add column if not exists screenshot_captured_at timestamptz;

-- Sequence state.
--   seq_status: 'none' (not enrolled) | 'active' | 'stopped' (replied /
--               unsubscribed / suppressed) | 'completed' (step 4 sent)
--   seq_step:   highest step already sent (0..4)
--   seq_next_step_at: when the next step is due; null unless active
--   seq_sender_email: pins the whole ladder to one mailbox (thread consistency)
alter table leads add column if not exists seq_status text not null default 'none';
alter table leads add column if not exists seq_step int not null default 0;
alter table leads add column if not exists seq_next_step_at timestamptz;
alter table leads add column if not exists seq_sender_email text;

-- Scheduler hot path: "active leads whose next step is due".
create index if not exists leads_seq_due_idx
  on leads (seq_next_step_at) where seq_status = 'active';
