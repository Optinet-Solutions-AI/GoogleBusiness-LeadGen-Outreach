# Email template library + voice-agent picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saved, versioned email templates (Templates page + Send email), a Regenerate button, a demo-link switch for
website emails, and a Voizo agent picker in Call with AI.

**Architecture:** Migration 064 adds `email_templates`, `email_template_versions`, `voice_agents`,
`campaign_leads.voizo_campaign_id`. Pure token rendering in `lib/email/template-render.ts`; DB + versioning in
`lib/email/template-library.ts`; agents in `lib/calls/voice-agents.ts`. Thin routes; two new pages under Outreach.

**Tech Stack:** Next.js 14, TypeScript, Supabase, Gemini (`lib/services/gemini.ts`), Voizo Dial API, vitest (only
`lib/**/*.test.ts` run; run from an upper-case `C:\` cwd).

**Spec:** `docs/superpowers/specs/2026-11-19-templates-and-voice-agents-design.md`

## Global Constraints

- Tokens exactly: `{{business}} {{first_name}} {{city}} {{category}} {{demo_link}} {{site}} {{rating}} {{reviews}} {{event}} {{booth}} {{sender}}`.
- Every template create/update writes an `email_template_versions` row (version 1, 2, …); restore = update with that
  version's content (new version). Archive only, never delete.
- Code works before 064 is applied: list/read return empty + a note (`missing table` detection like other modules);
  the call path never writes `voizo_campaign_id` when the column is missing (fall back without it).
- Voizo `placeCall` gets `campaignId` only when an agent is chosen; never retried.
- Regenerate: one Gemini call, no "free"/"guarantee", keeps links/names/language, plain text.
- File headers, zod at route boundaries, `{success,data|error}`.

## Review Focus

1. A saved template with `{{demo_link}}` on its own line, lead without a demo → that line disappears, no blank gap. (Task 1 test.)
2. A typo token `{{bussiness}}` → reported as unknown, left visible in the preview. (Task 1 test.)
3. Restoring version 1 of a template at version 3 → becomes version 4 with v1's content; v2/v3 still listed. (Task 2 test.)
4. Two agents marked default → only the last saved stays default. (Task 5 test.)
5. Queued call with an agent whose row was archived → still dials with the saved script id (it's on the queue entry). (Task 5 test.)

---

### Task 1: Migration 064 + token rendering
Files: `db/migrations/064_templates_agents.sql`, `db/schema.sql`, Create `web/lib/email/template-render.ts` (+ test).
Produces: `TEMPLATE_TOKENS: readonly string[]`; `type TemplateVars = Partial<Record<"business"|"first_name"|"city"|"category"|"demo_link"|"site"|"rating"|"reviews"|"event"|"booth"|"sender", string | number | null>>`;
`renderTemplate(text: string, vars: TemplateVars): string` (fills tokens; drops a line that held only empty tokens and whitespace/punctuation; collapses 3+ newlines to 2); `unknownTokens(text: string): string[]`;
`varsForLead(c: { businessName; ownerName?; city?; category?; demoUrl?; platform?; rating?; reviewCount?; eventName?; booth?; senderName? }): TemplateVars` (first name only, city before comma, rating as "2.4★", reviews as "38 reviews").
- [ ] RED tests (incl. Review Focus 1–2) → GREEN → commit `feat(db): template + voice agent tables (064), template tokens`.

### Task 2: Template library (DB + versions) and API
Files: Create `web/lib/email/template-library.ts` (+ pure test), routes `web/app/api/email-templates/route.ts` (GET list, POST create),
`[id]/route.ts` (GET, PATCH update/archive), `[id]/versions/route.ts` (GET), `[id]/restore/route.ts` (POST `{version}`).
Produces: `TemplateInputSchema` (zod: name 1–80, service_key nullable string, subject 1–200, body 1–5000, follow_up_1/2 ≤ 5000 default "");
pure `nextVersion(existing: number[]): number`; `listTemplates({includeArchived?})`, `createTemplate(input)`, `updateTemplate(id, input, note?)`,
`archiveTemplate(id, archived)`, `listVersions(id)`, `restoreVersion(id, version)`.
- [ ] RED tests for `nextVersion` and `TemplateInputSchema` (+ Review Focus 3 as a pure `restorePatch(versions, v)` test) → GREEN → commit.

### Task 3: Templates page
Files: `web/app/(dashboard)/email-templates/page.tsx`, `web/components/templates/TemplatesClient.tsx`, `web/lib/nav.ts` (Outreach → "Templates").
List (name, offer, updated, archived toggle), New, Edit form with token chips + unknown-token warning, History panel with
View/Restore, Archive/Unarchive. No new pure logic (uses Task 1–2). Verify: typecheck, lint, build. Commit.

### Task 4: Send email — saved templates, Save as template, demo-link switch, Regenerate
Files: `web/components/outreach/SimpleEmailModal.tsx`, Create `web/lib/email/regenerate-copy.ts` (+ test of its pure prompt/cleanup),
`web/lib/services/gemini.ts` (`rewriteOutreachEmail({subject, body, followUps})`), route `web/app/api/leads/[id]/send-email/regenerate/route.ts`.
Produces: `cleanRewrite(out): {subject, body, followUps} | null` (pure: strips em dashes, "free"→removed check rejects, keeps ≤ 3 follow-ups shape).
Modal: offer list = built-ins + "Saved: <name>" (rendered with `varsForLead`); "Save as template" (prompt name → POST); "Include the demo website link"
switch when demo exists and offer is website/redesign (refill with/without `demoUrl`); "Regenerate" button.
- [ ] RED test `cleanRewrite` → GREEN → typecheck/lint → commit.

### Task 5: Voice agents
Files: Create `web/lib/calls/voice-agents.ts` (+ test), routes `web/app/api/voice-agents/route.ts` (GET, POST), `[id]/route.ts` (PATCH),
page `web/app/(dashboard)/voice-agents/page.tsx` + client, `web/lib/nav.ts` (Outreach → "Voice agents"), `web/lib/services/voizo.ts`
(`placeCall` + `campaignId?`), `web/lib/calls/quick-call.ts` (`agentId` → saves `voizo_campaign_id`), `web/lib/pipeline/call-scheduler.ts`
(load the queue entry's `voizo_campaign_id`, pass as `campaignId`), `web/lib/calls/load-call-preview.ts` (+ agents list), `web/app/api/leads/[id]/call/route.ts`
(`agent_id`), `web/components/outreach/CallPreviewModal.tsx` (Agent dropdown + "Test in Script Builder ↗").
Produces: `AgentInputSchema` (name 1–80, voizo_campaign_id 1–100, script_builder_url url|null, is_default bool);
pure `defaultAgent(agents): Agent | null`, `withSingleDefault(agents, savedId): string[]` (ids to un-default).
- [ ] RED tests (Review Focus 4–5: placeCall body includes campaignId only when set) → GREEN → commit.

### Task 6: Docs + build
CLAUDE.md (064, routes, pages), `web/lib/assistant/knowledge.ts`, `workflows/manage_email_templates.md` (new), `workflows/call_leads_voizo.md`
(agents), `docs/status/2026-W47.md`. Full suite, typecheck, lint, `npm run build`. Commit.
