-- 024_campaign_channel.sql — add an outreach channel to campaigns.
--
-- A campaign now targets a channel (voice_agent | sms | dm | email); the candidate leads are
-- filtered to those reachable that way. Nullable so legacy campaigns stay valid.
--
-- Apply with:
--   psql "$SUPABASE_URL" -f db/migrations/024_campaign_channel.sql   (run by the operator)

alter table call_campaigns add column if not exists channel text
    check (channel in ('voice_agent','sms','dm','email'));
create index if not exists call_campaigns_channel_idx on call_campaigns(channel);
