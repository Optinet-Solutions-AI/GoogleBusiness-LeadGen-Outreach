-- 011_lead_rebuild_started_at.sql
--
-- Adds a refresh-safe "rebuild in progress" signal. The dashboard's
-- "Rebuild on latest template" button used to track its spinner state in
-- React state only — so refreshing the page after clicking it (or opening
-- the lead from a different browser) made it look like the job had
-- canceled, even though the Cloud Run Job was still running.
--
-- Usage:
--   - /api/leads/[id]/regenerate sets this to now() before triggering Cloud Run
--   - LeadActions reads it on mount and shows the spinner if it's < 5 min old
--   - The polling loop clears it (sets back to NULL) once the new demo_url
--     lands or last_error is set
--   - If anything crashes silently, the column will be > 5 min old on the
--     next page load and the UI naturally falls out of the rebuilding state

alter table leads
    add column if not exists rebuild_started_at timestamptz;
