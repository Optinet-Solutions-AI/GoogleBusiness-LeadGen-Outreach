# Workflow — Handle a reply

**Objective:** Move a lead from `replied` → `meeting_booked` → `meeting_done`, then route to **improve** or **handover**.

## Inputs
- A lead at `stage = 'replied'` (set automatically by the Instantly webhook)
- The reply itself (read in Instantly's inbox)

## Steps

1. **Triage the reply.**
   - Interested → schedule a call/meeting (15–30 min).
   - Not now → mark `dead` via `PATCH /api/leads/<id>` with `{ "stage": "dead" }`.
   - Wrong contact / bounce → mark `dead`, optionally re-scrape with a different email.

2. **Book the meeting.**
   ```bash
   curl -X POST http://localhost:3000/api/leads/<id>/meeting \
       -H "Content-Type: application/json" \
       -d '{"status":"booked","notes":"call Tue 2pm via Cal.com"}'
   ```
   Lead → `meeting_booked`. Notes are timestamp-prefixed and appended.

3. **Run the meeting.** Talk through the demo. Get them to commit to:
   - Real photos (3–10 of their best work)
   - Their service area (cities they'll travel to)
   - Their actual business hours
   - Any copy edits ("we don't do tankless heaters; remove that")
   - A domain (theirs to register, OR they bought one already)

4. **Mark meeting done.**
   ```bash
   curl -X POST http://localhost:3000/api/leads/<id>/meeting \
       -H "Content-Type: application/json" \
       -d '{"status":"done","notes":"agreed: $X setup + $Y/mo. domain: joesplumbingatx.com"}'
   ```
   Lead → `meeting_done`.

5. **Decide next step.**
   - **Improve** the demo with their real data first → `workflows/improve_after_meeting.md`
   - **Handover** the existing demo as-is → `workflows/handover_to_client.md`
   - **Mark closed_lost** if they backed out → `PATCH /api/leads/<id>` with `{ "stage": "closed_lost" }`

## Don't
- Don't reply on the demo URL itself — replies go to Instantly's inbox (then to ops).
- Don't skip the meeting note. Future-you needs it during handover.
