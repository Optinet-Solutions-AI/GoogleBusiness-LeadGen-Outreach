-- 042_campaign_copy_style.sql — which email STYLE a campaign sends.
--
-- friendly (default) | direct | curiosity. Per segment there are 3 full
-- sequence styles (see lib/email/sequence-templates.ts); the operator picks one
-- per campaign and the scheduler renders that style.

alter table call_campaigns add column if not exists copy_style text not null default 'friendly';
