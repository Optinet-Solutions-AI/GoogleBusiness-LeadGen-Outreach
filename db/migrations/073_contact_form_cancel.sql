-- 073_contact_form_cancel.sql — a contact form attempt the operator cancelled (26 Nov 2026).
--
-- Adds the status 'cancelled' to contact_form_runs: Cancel on a look / send in progress, honoured until AI presses Send.
-- Until this is applied, Cancel still works: the attempt is recorded as 'failed' with the reason "Cancelled…".

alter table contact_form_runs drop constraint if exists contact_form_runs_status_check;
alter table contact_form_runs add constraint contact_form_runs_status_check
    check (status in ('looking','ready','no_form','sending','sent','blocked','failed','unknown','cancelled'));
