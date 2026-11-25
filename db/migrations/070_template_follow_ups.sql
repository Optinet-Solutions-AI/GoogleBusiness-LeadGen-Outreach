-- 070_template_follow_ups.sql — saved templates hold up to three follow-ups, each with its own subject (25 Nov 2026).
--
-- Meny: "I want to be able to send different follow-ups … change the subject line on each follow-up and the text."
--   follow_up_3          — the third follow-up's text (day 12)
--   follow_up_subject_N  — the Nth follow-up's own subject; '' = "Re: <first subject>" (same thread)
-- On both the template and each saved version. The code tolerates them missing (templates then keep two follow-ups
-- with "Re:" subjects).

alter table email_templates add column if not exists follow_up_3 text not null default '';
alter table email_templates add column if not exists follow_up_subject_1 text not null default '';
alter table email_templates add column if not exists follow_up_subject_2 text not null default '';
alter table email_templates add column if not exists follow_up_subject_3 text not null default '';

alter table email_template_versions add column if not exists follow_up_3 text not null default '';
alter table email_template_versions add column if not exists follow_up_subject_1 text not null default '';
alter table email_template_versions add column if not exists follow_up_subject_2 text not null default '';
alter table email_template_versions add column if not exists follow_up_subject_3 text not null default '';
