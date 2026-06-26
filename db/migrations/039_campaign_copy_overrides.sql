-- 039_campaign_copy_overrides.sql
-- Operator-editable outreach copy, per campaign. Each campaign can override the
-- subject/body of any sequence step; absent steps fall back to the system
-- default template. Shape: { "1": { "subject": "...", "body": "..." }, "2": {...} }.
-- The body is plain text with {{business_name}} / {{first_name}} / {{demo_link}}
-- tokens and {spintax|variants}; the renderer fills tokens + resolves spintax
-- + auto-translates at send time, exactly like the defaults.

alter table call_campaigns add column if not exists copy_overrides jsonb;
