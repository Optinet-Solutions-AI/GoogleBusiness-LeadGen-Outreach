-- 013_lead_photo_cache.sql
--
-- Caches per-lead photo selection so the Gemini Vision call in stage-3
-- fires once per lead lifetime (not once per rebuild). Three columns:
--
--   hero_photo_url    text     — chosen hero URL (stock or real)
--   photo_order_json  jsonb    — full ordered photo array (length 6)
--   photos_picked_at  timestamptz — last time we ran the selector
--
-- A cache hit requires BOTH hero_photo_url AND photo_order_json to be
-- non-NULL; partial state from a half-failed prior write triggers a
-- re-pick. Cleared by /api/leads/:id/build?refresh-photos=1 when the
-- operator wants a fresh selection (e.g. after Improve added new photos).
--
-- See docs/superpowers/specs/2026-05-25-personalized-site-photos-design.md

alter table leads
    add column if not exists hero_photo_url    text,
    add column if not exists photo_order_json  jsonb,
    add column if not exists photos_picked_at  timestamptz;
