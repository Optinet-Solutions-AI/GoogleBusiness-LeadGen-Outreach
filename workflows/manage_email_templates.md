# Manage email templates (saved, versioned) + Regenerate + the demo-link switch

**Owner code:** `web/lib/email/template-library.ts` (DB + versions), `web/lib/email/template-render.ts` (placeholders,
pure), `web/lib/email/regenerate-copy.ts` (+ `rewriteOutreachEmail` in `lib/services/gemini.ts`), page
`/email-templates`, `components/outreach/SimpleEmailModal.tsx`. Migration **064**. Design:
`docs/superpowers/specs/2026-11-19-templates-and-voice-agents-design.md`.

## Templates page (Outreach → Templates)

- **New template:** name, the offer it's for (or any), subject, email, up to two follow-ups.
- **Placeholders**, filled for each lead: `{{business}} {{first_name}} {{city}} {{category}} {{demo_link}} {{site}}
  {{rating}} {{reviews}} {{event}} {{booth}} {{sender}}`. A line with only an empty placeholder (e.g. `{{demo_link}}`
  for a lead without a demo) is left out. A misspelt placeholder shows a warning and is never filled.
- **Edit = new version.** Every save keeps the old one. **History** lists all versions with date; **Restore** brings
  an old one back as the newest version, so nothing is ever lost.
- **Archive**, never delete. "Show archived" brings archived ones back into view.

## In Send email

- "What are you offering?" shows **Ready-made** (built in, can't be broken) and **Saved templates**.
- **Save as template** saves what's in the window; this lead's name, city, link etc. are turned back into placeholders.
- **Regenerate** rewrites the email (and follow-ups) with Gemini, free tier: same offer, facts, names, links and
  language. A rewrite that drops a link or uses spam words (free, guarantee…) is refused; press again.
- **Include the demo website link** (website / redesign emails, when the lead has a demo): untick to send without it.
- Follow-ups from a saved template are only scheduled while the follow-up options are shown (hidden while testing).

## When it fails

- "needs database update 064" → run `db/migrations/064_templates_agents.sql` in Supabase.
- Regenerate says Gemini is unavailable → `GOOGLE_GENAI_API_KEY` missing in Vercel, or try again in a minute.
