-- 036_segment_reviewed.sql
-- Decouple "a human reviewed this lead's segment" from "the offer is locked".
--
-- offer_locked is a CONTROL flag (pipeline must not re-route). Clearing it
-- ("Manual · clear lock") hands routing back to the pipeline — but that used to
-- erase the only record that a human had ever looked at the lead. This adds a
-- never-cleared audit stamp so the dashboard can show a "reviewed" badge
-- independent of the current lock state.
--
-- Set (server-side, in PATCH /api/leads/:id) on any manual segment/offer pick;
-- never cleared by clearing offer_locked. Backfilled true for already-locked rows.

alter table leads add column if not exists segment_reviewed_at timestamptz;

update leads set segment_reviewed_at = coalesce(updated_at, now())
where offer_locked = true and segment_reviewed_at is null;
