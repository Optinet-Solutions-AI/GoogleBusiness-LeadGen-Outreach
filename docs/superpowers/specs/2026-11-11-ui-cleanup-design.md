# UI clean-up: contacts first, one action per channel, source-first batches

**Date:** 2026-11-11 · **Asked by:** Chris (for Meny / Steve) · **Status:** built the same day

## Why

Meny's feedback: the dashboard is "all over the place". The team can't tell where to send an email or start an
AI call from a lead, can't see a lead's contact details at a glance, and the New batch form shows every source
(WARN, SEC, booths) even when they picked a Home Services niche. GPT finds owners and emails, but nothing in the UI
lets them run it on a lead.

## The scan (what was wrong)

| Screen | Redundant / confusing | Missing |
|---|---|---|
| Leads list | "Verify" and "Signal" filters are jargon; Email column only | Phone, owner; per-lead Send email / Call with AI; Find contacts (AI); bulk email / call |
| Lead page | 13 cards. Contact details split across Identity (phone), right-rail Contact (email edit) with a stale "use the Voice outreach panel above" note, "Contact details found" box inside Website verdict (owner), Email verification card (audit rows) | One contact card; Send email / Call with AI / Find contacts buttons; a plain "ready to send?" verdict |
| New batch | All 6 source buttons always visible; WARN/SEC/exhibitor entries mixed into the niche dropdown as a fake "Liquidation & Surplus" category; default niche "liquidation store" | Source first, then only that source's fields |
| Nav | Status overlaps Analytics; Social is a niche worklist | — (left as is; a merge is a separate decision) |

## What changes

1. **Contact card** on every lead page, directly under the name: phone (tap to call), email + its status in words
   (Ready to send / Not checked / Bad address / Catch-all) with edit + re-check, owner + role, contact page, and
   "where this came from" sources. Three buttons: **Send email**, **Call with AI**, **Find contacts (AI)**.
   The old scattered pieces (right-rail Contact section, "Contact details found" box, Email verification card) go.
2. **Find contacts (AI)** — `POST /api/leads/:id/contacts`: OpenAI web search first, then the own-site crawl, saved
   on the lead (email only if none yet, phone only if none, owner, contact page, sources). About 3¢. Works on one lead
   from the lead page, or on a selection from the leads list (run one by one, capped at 25 per go).
3. **Call with AI** (one lead) — `POST /api/leads/:id/call`: adds the lead to the standing active "Quick calls (AI)"
   campaign (created on first use, Mon–Sun 9–20 in the lead's country time) so the 15-minute call timer dials it.
   Refuses with a plain reason: no phone, GDPR country, do-not-call, Voizo not connected.
4. **Leads list**: a Contact column (phone, email status, owner); per-row Email / Call buttons; bulk
   **Find contacts (AI)** / **Email selected** / **Call selected** next to Build and Add to campaign. Filters renamed:
   Email status (Ready to send / Not checked / Bad address), Lead type (was Signal).
5. **New batch form**: first choice is the source — *Local businesses (Google Maps)*, *Closing businesses (US
   notices)*, *Conference exhibitors (Europe)*. Each shows only its own fields. The three Google providers move into a
   collapsed "Data provider" row (Apify default). Source entries leave the niche dropdown. Default: Home Services →
   locksmith, US.

## Not changed (and why)

- Nav structure: merging Status into Analytics and retiring Social are product decisions; listed for Meny.
- Campaign wizard: still the place for scheduled bulk sends with copy overrides; the new buttons cover one-off work.
- No migration: everything uses existing columns (`contact_*` from 052/053, `call_campaigns`, `campaign_leads`).
