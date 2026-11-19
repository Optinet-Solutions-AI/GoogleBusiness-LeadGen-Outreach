# Email template library, Regenerate, demo-link switch, voice-agent picker — design

Date: 2026-11-19 · From Chris's meeting notes (15:17–15:18) and his answers: templates are saved in the app **with a
version history** ("for security"); voice agents are built and tested in **Voizo's Script Builder** (the brain), our app
only picks which one calls. Operator said "build it" (no more questions); calls marked "my call" are Claude's.

## Goals

1. **Saved email templates with history.** A Templates page (Outreach → Templates) to add, edit and archive templates
   (name, which offer it's for, subject, body, two follow-ups). Every save keeps the previous version; any version can
   be viewed and restored (restoring makes a new version). Nothing is ever hard-deleted (archive only).
   Templates use tokens filled per lead: `{{business}} {{first_name}} {{city}} {{category}} {{demo_link}} {{site}}
   {{rating}} {{reviews}} {{event}} {{booth}} {{sender}}`. A line whose only token is empty for this lead
   (e.g. `{{demo_link}}` with no demo) is dropped; an unknown token is shown as a warning, never sent silently.
2. **Send email uses them.** "What are you offering?" lists the built-in templates (unchanged, in code) and the saved
   ones. "Save as template" stores what's in the window (asks for a name). Built-ins stay read-only; saving one makes an
   editable copy (my call — keeps a safe default that can't be broken).
3. **Regenerate.** A button in Send email that rewrites the current subject/body (and follow-ups) with Gemini: same
   offer, facts, names, links and language; plain text, no "free"/"guarantee", ≤ 120 words, one question, keeps the
   "Just reply 'no'" line. One Gemini call (free tier), nothing sent.
4. **Website offer with or without link.** For the website and redesign offers, when the lead has a demo site, a
   switch "Include the demo website link" (on by default) refills the email with or without the link.
5. **Voice-agent picker.** A Voice agents page (Outreach → Voice agents) lists the Voizo scripts we may use: name,
   Voizo script (campaign) id, optional Script Builder link, one default. Voizo has no "list scripts" API, so they're
   typed in once (my call). The Call with AI window gets an **Agent** dropdown (default preselected) and
   "Test in Script Builder ↗" when a link is set. The chosen agent is saved on that queued call
   (`campaign_leads.voizo_campaign_id`) and sent to Voizo as `campaignId`; none chosen / no agents = Voizo's default,
   exactly as today.

## Non-goals

No browser/web test calls, no Vapi keys, no editing scripts in our app (Script Builder does that). No per-user
permissions (the app has no user accounts). No change to the classic screenshot sequence's copy.

## Constraints

Migration **064** (tables `email_templates`, `email_template_versions`, `voice_agents`; column
`campaign_leads.voizo_campaign_id`); code keeps working before it's applied (lists come back empty with a clear note,
the call path omits the column). Same rules as the rest of the app: thin zod-validated routes, `{success,data|error}`,
logic in `lib/`, file headers, tests for pure logic. Voizo: dial POST never retried; a Voizo refusal for a wrong script
id surfaces as the existing call error.
