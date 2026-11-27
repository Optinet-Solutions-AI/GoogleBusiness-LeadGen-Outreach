# Lead score (OpenAI) + cost per reply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every qualified lead gets an OpenAI 0–100 score with reasons (shown, sortable, used by the Brain and batch
email ordering), and `/analytics` shows cost per reply by niche / city / offer.

**Architecture:** Pure rules in `web/lib/leads/lead-score.ts` (schema, input text, parse, band, sort); one OpenAI
caller reusing `brainJson` with a model override; scoring runs as the last per-lead step of stage 1 and on demand
(lead route, Cloud Run `MODE=lead-score` for a batch). Cost per reply is a pure grouping module + a read-only loader +
an analytics section; Test mode's on/off history (kept in the existing setting) removes test-period activity.

**Tech Stack:** TypeScript, Next.js 14 App Router, Supabase, vitest, OpenAI Responses API.

**Spec:** `docs/superpowers/specs/2026-11-27-lead-score-and-cost-per-reply-design.md`

## Global Constraints

- Every new TS file starts with the required header (`/** <file> — purpose · Inputs · Outputs · Used by */`).
- Client components are dumb; routes thin (validate → `lib/`) returning `{ success, data | error }` via `ok` / `fail`.
- External calls only via `lib/services/*`, with `retry` + logger.
- The AI never sees an email address or a phone number.
- The score never blocks, skips or contacts a lead by itself.
- Bands: **Hot 70–100, Warm 40–69, Cold 0–39**.
- Env: `LEAD_SCORE_MAX_PER_BATCH` default 100 (0 = off), `OPENAI_SCORE_MODEL` default `gpt-5.4-mini`, priced with
  `OPENAI_CONTACT_USD_PER_MTOK_IN/_OUT`. Estimate price `LEAD_SCORE_USD_PER_LEAD = 0.005`.
- Score again refused within 2 minutes of the last score (429, nothing paid).
- Migration **076**; code tolerates its columns missing (no crash, no lost saves).
- Test mode stays ON; nothing here sends anything. Never run `scripts/test-mode.ts --off`.
- Commands run from `web/`: tests `npx vitest run <file>`, types `npm run typecheck`.
- Commits: Conventional Commits, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push.

## Review Focus

1. A lead with almost no facts (no website, no rating, no research): the AI still returns a valid score; reasons must
   not invent facts — `scoreInput` says "unknown" explicitly (tested in Task 1).
2. OpenAI returning junk / out-of-range numbers: `parseScore` rejects or clamps, never stores NaN (Task 1).
3. Database without 076: stage-1 save, Leads list sort by score, batch email and Brain must all still work (Tasks 3, 5, 6).
4. A batch whose leads all have `estimated_cost_usd` null or 0, or a batch with no leads: cost per reply shows "—",
   never divides by zero (Task 8).
5. Test mode switched off then on again: activity in both on-periods is excluded, the off-period counts (Task 7, 8).

---

### Task 1: Score rules (pure)

**Files:**
- Create: `web/lib/leads/lead-score.ts`
- Test: `web/lib/leads/lead-score.test.ts`

**Interfaces:**
- Produces:
  - `type ScoreBand = "hot" | "warm" | "cold"`
  - `interface LeadScore { score: number; band: ScoreBand; reasons: string[]; holding_back: string; model: string; usd: number; scored_at: string }`
  - `interface ScoreFacts { business_name: string; category: string | null; place: string | null; rating: number | null; review_count: number | null; segment: string; offer_label: string; website: string /* one line from website_review or "not checked" */; research: string | null; signal: string | null; email: "own_verified" | "own_unchecked" | "head_office" | "bad" | "none"; has_phone: boolean; has_contact_page: boolean; owner_known: boolean }`
  - `SCORE_SCHEMA` (strict JSON schema: `score` integer, `reasons` array of strings, `holding_back` string; all required, `additionalProperties: false`)
  - `SCORE_INSTRUCTIONS: string` (what the score means — likely to reply AND buy the named offer; use only the facts given; each reason names a fact; say "unknown" facts lower confidence, never guess)
  - `bandOf(score: number): ScoreBand`
  - `scoreInput(f: ScoreFacts): string`
  - `parseScore(raw: unknown, meta: { model: string; usd: number; scored_at: string }): LeadScore | null`
  - `factsFromLead(l: ScoreLead): ScoreFacts` where `ScoreLead` = the lead row fields listed in Step 3
  - `scoreWait(lastAt: string | null, now: Date): number` (seconds left of the 2-minute cooldown, 0 = may run)
  - `byScoreDesc(a: { lead_score?: number | null }, b: { lead_score?: number | null }): number` (high first, null last)

- [ ] **Step 1: Write the failing tests**

```ts
describe("bandOf", () => {
  it("70+ hot, 40–69 warm, under 40 cold", () => {
    expect([bandOf(100), bandOf(70), bandOf(69), bandOf(40), bandOf(39), bandOf(0)]).toEqual(["hot", "hot", "warm", "warm", "cold", "cold"]);
  });
});
describe("parseScore", () => {
  const meta = { model: "m", usd: 0.004, scored_at: "2026-11-27T10:00:00Z" };
  it("keeps a good answer, rounds and adds the band", () => {
    expect(parseScore({ score: 82.4, reasons: ["No website", "4.8★ from 120 reviews"], holding_back: "No email found" }, meta))
      .toEqual({ score: 82, band: "hot", reasons: ["No website", "4.8★ from 120 reviews"], holding_back: "No email found", ...meta });
  });
  it("clamps to 0–100 and keeps at most 3 non-empty reasons", () => {
    const s = parseScore({ score: 140, reasons: ["a", "", "b", "c", "d"], holding_back: "" }, meta)!;
    expect(s.score).toBe(100);
    expect(s.reasons).toEqual(["a", "b", "c"]);
  });
  it("rejects junk", () => {
    expect(parseScore(null, meta)).toBeNull();
    expect(parseScore({ score: "high", reasons: [], holding_back: "" }, meta)).toBeNull();
    expect(parseScore({ score: NaN, reasons: ["a"], holding_back: "" }, meta)).toBeNull();
    expect(parseScore({ score: 50, reasons: [], holding_back: "x" }, meta)).toBeNull(); // no reason = not evidence-based
  });
});
describe("scoreInput", () => {
  it("never contains an email address or phone number, says unknown facts plainly", () => {
    const text = scoreInput({ business_name: "Joe's Plumbing", category: null, place: null, rating: null, review_count: null, segment: "no_website",
      offer_label: "Build a website", website: "not checked", research: null, signal: null, email: "none", has_phone: true, has_contact_page: false, owner_known: false });
    expect(text).toContain("Joe's Plumbing");
    expect(text).toMatch(/Google rating: unknown/);
    expect(text).toMatch(/Offer we would pitch: Build a website/);
    expect(text).not.toMatch(/@|\+?\d[\d\s-]{7,}/);
  });
});
describe("factsFromLead", () => {
  it("turns contact data into yes/no facts only", () => {
    const f = factsFromLead({ id: "L1", business_name: "A", category: "Plumber", address: "1 Main St, Austin, TX", country_code: "us", rating: 4.6, review_count: 30,
      email: "joe@joes.com", verification_status: "valid", phone: "+1 512 555 0100", contact_page_url: null, contact_owner_name: "Joe",
      website_url: "https://joes.com", website_review: null, ai_profile: { summary: "Family business", email_scope: "own" }, signal_type: null, signal_meta: null,
      call_segment: "has_website", has_website: true, website_kind: null, needs_improvement: false, primary_offer: null });
    expect(f.email).toBe("own_verified");
    expect(f.has_phone).toBe(true);
    expect(f.owner_known).toBe(true);
    expect(JSON.stringify(f)).not.toContain("joe@joes.com");
    expect(JSON.stringify(f)).not.toContain("555");
  });
  it("head-office inbox and bad address are told apart", () => {
    const base = { id: "L", business_name: "B", category: null, address: null, country_code: null, rating: null, review_count: null, phone: null,
      contact_page_url: null, contact_owner_name: null, website_url: null, website_review: null, signal_type: null, signal_meta: null,
      call_segment: null, has_website: false, website_kind: null, needs_improvement: null, primary_offer: null };
    expect(factsFromLead({ ...base, email: "info@hq.com", verification_status: "likely", ai_profile: { email_scope: "head_office" } }).email).toBe("head_office");
    expect(factsFromLead({ ...base, email: "x@y.com", verification_status: "invalid", ai_profile: null }).email).toBe("bad");
    expect(factsFromLead({ ...base, email: null, verification_status: null, ai_profile: null }).email).toBe("none");
  });
});
describe("scoreWait + byScoreDesc", () => {
  it("2-minute cooldown", () => {
    const now = new Date("2026-11-27T10:02:00Z");
    expect(scoreWait("2026-11-27T10:01:00Z", now)).toBe(60);
    expect(scoreWait("2026-11-27T09:59:00Z", now)).toBe(0);
    expect(scoreWait(null, now)).toBe(0);
  });
  it("high scores first, unscored last", () => {
    const rows = [{ lead_score: null }, { lead_score: 40 }, { lead_score: 90 }, {}];
    expect(rows.sort(byScoreDesc).map((r) => r.lead_score ?? null)).toEqual([90, 40, null, null]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run lib/leads/lead-score.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `web/lib/leads/lead-score.ts`.** `ScoreLead` fields: `id, business_name, category, address,
  country_code, rating, review_count, email, verification_status, phone, contact_page_url, contact_owner_name,
  website_url, website_review, ai_profile, signal_type, signal_meta, call_segment, has_website, website_kind,
  needs_improvement, primary_offer`. Segment via `resolveSegment` (`lib/segment.ts`); offer label via
  `SERVICES.find(s => s.key === offerFor(lead))?.label` (`lib/campaigns/batch-email.ts` `offerFor`,
  `lib/email/service-templates.ts`). Email scope: `ai_profile.email_scope === "head_office" | "agency"` →
  `head_office`; `verification_status` `invalid` → `bad`; `valid`/`catch-all`/`likely` → `own_verified`; else
  `own_unchecked`. Website line reuses the shape `judgeInput` (`lib/brain/judge.ts`) prints. Signal line from
  `signal_type` + `signal_meta` (date / show / platform + rating), clipped to 200 chars. Pure — no server imports.

- [ ] **Step 4: Run** `npx vitest run lib/leads/lead-score.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): lead score rules (bands, input, parse)`.

---

### Task 2: OpenAI caller, settings, migration 076, scoring one lead

**Files:**
- Modify: `web/lib/services/openai-brain.ts` (`brainJson` takes optional `model?: string`, default `env.OPENAI_BRAIN_MODEL`)
- Modify: `web/lib/config.ts` (next to `OPENAI_WEBSITE_MODEL`): `OPENAI_SCORE_MODEL` default `"gpt-5.4-mini"`,
  `LEAD_SCORE_MAX_PER_BATCH` int ≥0 default 100, with a comment block like its neighbours
- Modify: `.env.example` (both, commented, next to `OPENAI_WEBSITE_MODEL`)
- Create: `db/migrations/076_lead_score.sql`; Modify: `db/schema.sql` (leads columns)
- Create: `web/lib/leads/lead-score-run.ts`; Test: `web/lib/leads/lead-score-run.test.ts`

**Interfaces:**
- Consumes: Task 1 (`factsFromLead`, `scoreInput`, `SCORE_SCHEMA`, `SCORE_INSTRUCTIONS`, `parseScore`, `scoreWait`, `LeadScore`, `ScoreLead`).
- Produces:
  - `SCORE_COLS = ["lead_score", "lead_score_detail", "lead_scored_at"] as const`
  - `scoreFields(s: LeadScore): { lead_score: number; lead_score_detail: LeadScore; lead_scored_at: string }`
  - `scoreLead(lead: ScoreLead, deps?: { ask?: typeof brainJson; now?: () => Date }): Promise<LeadScore | null>` — null when the answer can't be parsed; throws `BrainError` (not_configured / key_invalid / no_credit / failed) as `brainJson` does
  - `class ScoreTooSoonError extends Error { waitSeconds: number }` (message: "This lead was just scored. So you don't pay twice, it can be scored again in N seconds.")
  - `rescoreLead(leadId: string, deps?): Promise<LeadScore>` — loads the lead (`SCORE_LEAD_COLS`), refuses via `scoreWait(lead.lead_scored_at)`, scores, saves `scoreFields`; throws `Error("not found")`, `ScoreTooSoonError`, `Error("missing 076")` when the columns don't exist, `Error("no score")` when parse failed
  - `SCORE_LEAD_COLS: string` (the `ScoreLead` select list)

Migration 076 (exact):

```sql
-- 076_lead_score.sql — OpenAI lead score (27 Nov 2026): 0–100, band, reasons, what's holding it back.
alter table leads add column if not exists lead_score int;
alter table leads add column if not exists lead_score_detail jsonb;
alter table leads add column if not exists lead_scored_at timestamptz;
create index if not exists leads_lead_score_idx on leads (lead_score desc nulls last);
```

- [ ] **Step 1: Write the failing tests** (`lead-score-run.test.ts`, inject `ask`):

```ts
it("asks with the score model and returns the parsed score", async () => {
  const ask = vi.fn().mockResolvedValue({ data: { score: 74, reasons: ["No website", "Good reviews"], holding_back: "No email" }, usd: 0.003 });
  const s = await scoreLead(LEAD, { ask, now: () => new Date("2026-11-27T10:00:00Z") });
  expect(ask).toHaveBeenCalledWith(expect.objectContaining({ name: "lead_score", model: "gpt-5.4-mini", schema: SCORE_SCHEMA }));
  expect(ask.mock.calls[0][0].input).not.toContain(LEAD.email);
  expect(s).toMatchObject({ score: 74, band: "hot", usd: 0.003, scored_at: "2026-11-27T10:00:00.000Z" });
});
it("returns null on an unusable answer", async () => {
  const ask = vi.fn().mockResolvedValue({ data: { score: "?", reasons: [], holding_back: "" }, usd: 0.003 });
  expect(await scoreLead(LEAD, { ask })).toBeNull();
});
it("scoreFields puts the number in its own sortable column", () => {
  const s = { score: 55, band: "warm" as const, reasons: ["a"], holding_back: "b", model: "m", usd: 0, scored_at: "t" };
  expect(scoreFields(s)).toEqual({ lead_score: 55, lead_score_detail: s, lead_scored_at: "t" });
});
```

- [ ] **Step 2: Run** `npx vitest run lib/leads/lead-score-run.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the files above. `scoreLead` calls `ask({ name: "lead_score", model: env.OPENAI_SCORE_MODEL, instructions: SCORE_INSTRUCTIONS, input: scoreInput(factsFromLead(lead)), schema: SCORE_SCHEMA, maxOutputTokens: 400 })`. `rescoreLead` detects 076 missing by a select error mentioning `lead_score`.
- [ ] **Step 4: Run** the test file and `npx vitest run lib/brain` (brainJson callers unchanged) — Expected: PASS. `npm run typecheck` — Expected: no errors.
- [ ] **Step 5: Commit** `feat(web): score one lead with openai + migration 076`.

---

### Task 3: Scoring during scraping + the estimate

**Files:**
- Modify: `web/lib/pricing.ts` — `LEAD_SCORE_USD_PER_LEAD = 0.005`; `estimate(..., opts: { aiCap?; siteCap?; scoreCap? })` with `scoreCap` default **0** when omitted; wherever an "AI Lookup" line is pushed (Google Maps qualifying, exhibitors, closing businesses, review sites), push `{ item: "Lead score: how likely they are to reply and buy (OpenAI)", qty: min(that AI Lookup qty, scoreCap), unit_usd: 0.005 }` and add it to the scrape subtotal. `compare` passes `scoreCap` through.
- Modify every `estimate(`/`compare(` caller to pass `scoreCap: env.LEAD_SCORE_MAX_PER_BATCH`: `app/api/batches/route.ts`, `app/api/pricing/compare/route.ts`, `app/api/pricing/estimate/route.ts` (0 when `ai === "0"`), `lib/automation/schedules.ts`, `lib/brain/jobs.ts`, `lib/pipeline/orchestrator.ts`.
- Modify: `web/lib/pipeline/stage-1-scrape.ts` — a `ScoreRun = { left; used; usd }` made in `enrichInParallel` from `env.LEAD_SCORE_MAX_PER_BATCH`, set to 0 with the website check when OpenAI health isn't ok; passed to `enrichOne`; at the END of `enrichOne` (after `routeOffer` has set the offer) when `score.left > 0` and the lead is one AI Lookup ran on (`ai` eligibility, i.e. every qualified lead `enrichOne` gets): `score.left -= 1`, `scoreLead(row as ScoreLead)`, on success `Object.assign(row, scoreFields(s))`, `score.used++`, `score.usd += s.usd`; a `BrainError` with code `key_invalid`/`no_credit` sets `score.left = 0`; any error is logged (`stage_1.lead_score_failed`) and never fails the lead. Log `stage_1.lead_score_spend` like the others.
- Add `SCORE_COLS` to the optional-column handling: a missing-column error naming a score column drops only `SCORE_COLS` (same pattern as `REVIEW_COLS`).
- Test: `web/lib/pricing.test.ts`

- [ ] **Step 1: Failing tests** (append to `pricing.test.ts`):

```ts
it("adds the lead score line when scoreCap is given, capped like AI Lookup", () => {
  const e = estimate("apify", 100, { aiCap: 100, siteCap: 0, scoreCap: 100 });
  const line = e.scrape.lines.find((l) => /Lead score/.test(l.item))!;
  const lookups = e.scrape.lines.find((l) => /AI Lookup/.test(l.item))!;
  expect(line.qty).toBe(lookups.qty);
  expect(line.cost_usd).toBeCloseTo(line.qty * 0.005, 4);
});
it("no lead score line without scoreCap (old callers unchanged)", () => {
  expect(estimate("apify", 100).scrape.lines.some((l) => /Lead score/.test(l.item))).toBe(false);
});
it("scoreCap below the lookups caps the scored leads", () => {
  expect(estimate("apify", 100, { aiCap: 100, scoreCap: 5 }).scrape.lines.find((l) => /Lead score/.test(l.item))!.qty).toBe(5);
});
```

- [ ] **Step 2: Run** `npx vitest run lib/pricing.test.ts` — Expected: FAIL on the new tests.
- [ ] **Step 3: Implement** the pricing change, the callers, and the stage-1 hook.
- [ ] **Step 4: Run** `npx vitest run lib/pricing.test.ts lib/pipeline` — Expected: PASS. `npm run typecheck` — Expected: clean.
- [ ] **Step 5: Commit** `feat(pipeline): score each lead during scraping, in the estimate`.

---

### Task 4: Score again + Score this batch (Cloud Run) + workflow doc

**Files:**
- Create: `web/app/api/leads/[id]/lead-score/route.ts` — GET → `{ score: LeadScore | null }` (free); POST → `rescoreLead`; `ScoreTooSoonError` → 429 with its message; `not found` → 404; `BrainError` not_configured → 503 "Lead scoring isn't switched on (no OpenAI key). Ask the admin."; `missing 076` → 503 "Run database update 076 first."; else 502 "Couldn't score this lead: …". `maxDuration = 60`.
- Create: `web/lib/leads/lead-score-batch.ts` — `unscoredCount(batchId): Promise<number>` (qualified leads with `lead_score` null), `scoreBatch(batchId, deps?): Promise<{ scored: number; failed: number; usd: number }>` (at most `env.LEAD_SCORE_MAX_PER_BATCH`, 4 at a time, 12-minute time budget, stops on `key_invalid`/`no_credit`, saves each with `scoreFields`). Test: `lead-score-batch.test.ts` with injected `load`, `score`, `save`.
- Create: `web/app/api/batches/[id]/lead-score/route.ts` — GET → `{ unscored, cap, est_usd: min(unscored, cap) * LEAD_SCORE_USD_PER_LEAD }`; POST `{ confirm: true }` (zod; anything else 400) → `triggerJob({ MODE: "lead-score", BATCH_ID }, { oidcToken, timeoutSeconds: 1200 })` exactly as `app/api/leads/[id]/website-review/route.ts` triggers; 409 "Every lead in this batch already has a score." when unscored is 0.
- Modify: `web/scripts/cloud-run-job.ts` — add `"lead-score"` to the mode union / list / header comment; `MODE=lead-score BATCH_ID` → `scoreBatch`.
- Create: `workflows/score_leads.md` (what the score means, bands, when it runs, cost, Score again, Score this batch, env vars, 076). Modify: `CLAUDE.md` (a LEAD SCORE paragraph in "How the App Works", the env table rows, migration list line for 076, latest migration = 076, the API table rows, Cloud Run mode list), `web/lib/assistant/knowledge.ts` (a short "Lead score" entry).

**Interfaces:**
- Consumes: Task 2 (`rescoreLead`, `ScoreTooSoonError`, `scoreLead`, `scoreFields`, `SCORE_LEAD_COLS`), Task 3 (`LEAD_SCORE_USD_PER_LEAD`).
- Produces: `GET/POST /api/leads/:id/lead-score`, `GET/POST /api/batches/:id/lead-score` (used by Task 5's buttons).

- [ ] **Step 1: Failing tests** (`lead-score-batch.test.ts`):

```ts
it("scores up to the cap, 4 at a time, and totals the cost", async () => {
  const leads = Array.from({ length: 7 }, (_, i) => ({ id: `L${i}` }));
  const save = vi.fn();
  const r = await scoreBatch("B", { cap: 5, load: async () => leads, score: async () => ({ score: 50, band: "warm", reasons: ["a"], holding_back: "b", model: "m", usd: 0.004, scored_at: "t" }), save });
  expect(r).toEqual({ scored: 5, failed: 0, usd: 0.02 });
  expect(save).toHaveBeenCalledTimes(5);
});
it("stops at a dead key, counts unusable answers as failed", async () => {
  let n = 0;
  const r = await scoreBatch("B", { cap: 10, load: async () => [{ id: "a" }, { id: "b" }, { id: "c" }], save: vi.fn(),
    score: async () => { n++; if (n === 1) return null; throw new BrainError("no_credit", "x"); } });
  expect(r.scored).toBe(0);
  expect(r.failed).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Run** `npx vitest run lib/leads/lead-score-batch.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the files above (docs included).
- [ ] **Step 4: Run** the test file — Expected: PASS. `npm run typecheck` — Expected: clean.
- [ ] **Step 5: Commit** `feat(web): score again, score this batch (cloud run), score_leads workflow`.

---

### Task 5: Show the score (Leads list, batch page, lead page)

**Files:**
- Create: `web/lib/leads/lead-score-load.ts` — `fetchLeadScores(scope: { batchId: string } | { ids: string[] }): Promise<Map<string, ScoreSummary>>` in its own query, empty map when 076 is missing (same pattern as `lib/leads/website-verdicts.ts`). `ScoreSummary = { score: number; band: ScoreBand; reasons: string[]; holding_back: string }` — export the type from `lead-score.ts` (Task 1 file) so client components can import it.
- Modify: `web/app/(dashboard)/leads/page.tsx` — `LEAD_SORTS.score = "lead_score"`; attach `lead_score` from `fetchLeadScores` to each row; when the query errors and the sort key is `score`, run it again with the default order (076 missing).
- Modify: `web/components/LeadsTable.tsx` — a sortable **Score** column (key `score`) after Business: number + band chip (Hot / Warm / Cold), `title` = reasons joined + "Holding it back: …"; "—" when none.
- Modify: `web/components/BatchLeadsTables.tsx` + `web/app/(dashboard)/batches/[id]/page.tsx` — the same column on `BatchLeadsTable` (client-side sort by `byScoreDesc` when the operator clicks the header, if the table already sorts; otherwise just the column); a **Score this batch** button (new `web/components/batches/ScoreBatchButton.tsx`) shown when the batch is done/cancelled and GET says unscored > 0: shows "Score N leads, about $X", confirm, POST `{confirm:true}`, then "Scoring started — refresh in a few minutes".
- Create: `web/components/leads/LeadScoreBox.tsx` + render it on `web/app/(dashboard)/leads/[id]/page.tsx` next to the website check box: score, band chip, reasons list, "Holding it back", "Scored <date>", **Score again** (POST, shows the 429 / 503 message as plain text, `router.refresh()` on success). Not scored yet → "Not scored yet" + the button labelled "Score this lead".
- Test: append to `web/lib/leads/lead-score.test.ts`: `bandLabel("hot") === "Hot"`, `"warm" → "Warm"`, `"cold" → "Cold"` (export `bandLabel(b: ScoreBand): string` from `lead-score.ts`).

**Interfaces:**
- Consumes: Task 1 (`ScoreBand`, `bandLabel`, `byScoreDesc`, `ScoreSummary`), Task 4 routes.
- Produces: `fetchLeadScores` (used by Task 6).

- [ ] **Step 1: Failing test** — the `bandLabel` cases above.
- [ ] **Step 2: Run** `npx vitest run lib/leads/lead-score.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run** the test — Expected: PASS. `npm run typecheck` and `npm run lint` — Expected: clean.
- [ ] **Step 5: Commit** `feat(web): show the lead score on the leads list, batch and lead pages`.

---

### Task 6: The Brain and batch email work high scores first

**Files:**
- Modify: `web/lib/brain/judge.ts` — `JudgeLead` gains `lead_score?: number | null; lead_score_reasons?: string[]`; `judgeInput` adds, after the rating line, `Lead score: 82/100 (Hot). Why: <reasons joined "; ">` or `Lead score: not scored.`
- Modify: `web/lib/brain/plan.ts` — after loading leads, merge `fetchLeadScores({ batchId })` into each lead (`lead_score`, `lead_score_reasons`); `loadPlan` fetches `fetchLeadScores({ ids })` for the plan's lead ids (not an embed: 076 may be missing) and sets `score` on each `PlanRow`; sort = contact first, then `byScoreDesc`, then name.
- Modify: `web/components/brain/PlanTable.tsx` — `TableRow.score?: number | null`; show it as a small chip under the business name ("82 · Hot").
- Modify: `web/lib/campaigns/batch-email-plan.ts` — in `startBatchEmail`, before `staggerSends`, sort `eligible` by score (`fetchLeadScores({ batchId })` → `byScoreDesc` on `{ lead_score }`); stable for equal / missing scores (keep the original order).
- Test: `web/lib/brain/judge.test.ts` (append) and `web/lib/leads/lead-score.test.ts` (stability).

**Interfaces:**
- Consumes: Task 1 `byScoreDesc`, `bandOf`, `bandLabel`; Task 5 `fetchLeadScores`.

- [ ] **Step 1: Failing tests**

```ts
// judge.test.ts
it("tells the AI the lead score and why", () => {
  const text = judgeInput({ lead: { ...LEAD, lead_score: 82, lead_score_reasons: ["No website", "Good reviews"] }, moves, place: null });
  expect(text).toContain("Lead score: 82/100 (Hot). Why: No website; Good reviews");
  expect(judgeInput({ lead: { ...LEAD, lead_score: null }, moves, place: null })).toContain("Lead score: not scored.");
});
// lead-score.test.ts
it("byScoreDesc keeps the original order for ties and unscored (stable sort)", () => {
  const rows = [{ id: "a", lead_score: null }, { id: "b", lead_score: 50 }, { id: "c", lead_score: null }, { id: "d", lead_score: 50 }];
  expect([...rows].sort(byScoreDesc).map((r) => r.id)).toEqual(["b", "d", "a", "c"]);
});
```

(`LEAD` / `moves` = the fixtures already in `judge.test.ts`.)

- [ ] **Step 2: Run** `npx vitest run lib/brain/judge.test.ts lib/leads/lead-score.test.ts` — Expected: FAIL on the judge test.
- [ ] **Step 3: Implement** the changes above. Also add one line to `workflows/run_brain_job.md`: the Brain sees each lead's score and the plan lists high scores first.
- [ ] **Step 4: Run** `npx vitest run lib/brain lib/campaigns lib/leads` — Expected: PASS. `npm run typecheck` — clean.
- [ ] **Step 5: Commit** `feat(web): brain and batch email work high-scored leads first`.

---

### Task 7: Test mode on/off history

**Files:**
- Modify: `web/lib/test-mode-rules.ts` — `TestMode.history?: { on: boolean; at: string }[]`; `parseTestMode` keeps a valid `history` (drops malformed entries); new `withHistory(prev: TestMode, next: TestMode, now: Date): TestMode` (appends `{ on: next.on, at }` only when `on` changed; keeps prev history; history capped at 200 entries); new `testPeriods(m: TestMode, now: Date): { from: string; to: string }[]` (on-periods; no history → one period from `TEST_MODE_SINCE = "2026-11-26T00:00:00.000Z"` to now when `on`, none when off); new `inTestPeriod(at: string, periods): boolean`.
- Modify: `web/lib/test-mode.ts` — `setTestMode` reads the stored value and saves `withHistory(stored, mode, new Date())` (a failed read keeps `mode` as given).
- Test: `web/lib/test-mode-rules.test.ts` (append).

**Interfaces:**
- Produces: `testPeriods`, `inTestPeriod`, `TEST_MODE_SINCE` (used by Task 8).

- [ ] **Step 1: Failing tests**

```ts
const T = (on: boolean, history?: { on: boolean; at: string }[]) => ({ on, emails: [], phones: [], hosts: [], ...(history ? { history } : {}) });
it("withHistory records only a switch", () => {
  const now = new Date("2026-12-01T10:00:00Z");
  expect(withHistory(T(true), T(true), now).history ?? []).toEqual([]);
  expect(withHistory(T(true), T(false), now).history).toEqual([{ on: false, at: "2026-12-01T10:00:00.000Z" }]);
});
it("testPeriods: on since 26 Nov with no history; off then on again", () => {
  const now = new Date("2026-12-10T00:00:00Z");
  expect(testPeriods(T(true), now)).toEqual([{ from: "2026-11-26T00:00:00.000Z", to: "2026-12-10T00:00:00.000Z" }]);
  const m = T(true, [{ on: false, at: "2026-12-01T00:00:00.000Z" }, { on: true, at: "2026-12-05T00:00:00.000Z" }]);
  const p = testPeriods(m, now);
  expect(p).toEqual([{ from: "2026-11-26T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z" }, { from: "2026-12-05T00:00:00.000Z", to: "2026-12-10T00:00:00.000Z" }]);
  expect(inTestPeriod("2026-12-03T00:00:00Z", p)).toBe(false);
  expect(inTestPeriod("2026-12-06T00:00:00Z", p)).toBe(true);
  expect(inTestPeriod("2026-11-20T00:00:00Z", p)).toBe(false);
});
it("parseTestMode keeps history and drops junk entries", () => {
  expect(parseTestMode({ on: true, emails: [], phones: [], hosts: [], history: [{ on: false, at: "2026-12-01T00:00:00.000Z" }, { on: "x" }, 5] }).history)
    .toEqual([{ on: false, at: "2026-12-01T00:00:00.000Z" }]);
});
```

- [ ] **Step 2: Run** `npx vitest run lib/test-mode-rules.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** The first history entry being `on:false` means it was on from `TEST_MODE_SINCE` until then.
- [ ] **Step 4: Run** `npx vitest run lib/test-mode-rules.test.ts lib/test-mode.test.ts` (if present) — Expected: PASS. `npm run typecheck` — clean.
- [ ] **Step 5: Commit** `feat(web): test mode keeps its on/off history`.

---

### Task 8: Cost per reply on /analytics

**Files:**
- Create: `web/lib/analytics/cost-per-reply.ts` (pure) + `web/lib/analytics/cost-per-reply.test.ts`
- Create: `web/lib/analytics/cost-per-reply-load.ts` (read-only loader, `import "@/lib/server-guard"`)
- Create: `web/components/analytics/CostPerReply.tsx` (dumb table + Group by / range links as `?cpr=niche|city|offer&cprdays=30|90|all`)
- Modify: `web/app/(dashboard)/analytics/page.tsx` (render the section, read the two params; header comment)
- Create: `workflows/read_cost_per_reply.md` (what each column means, the spend rule, test mode exclusion). CLAUDE.md: one line under the analytics / item list. `web/lib/assistant/knowledge.ts`: a short entry.

**Interfaces:**
- Consumes: Task 7 `testPeriods`, `inTestPeriod`; `OFFER_LABEL` (`lib/offers.ts`), `SERVICES` + `offerFor` for the offer label.
- Produces:
  - `type GroupBy = "niche" | "city" | "offer"`
  - `interface CprBatch { id: string; niche: string; city: string; created_at: string; estimated_cost_usd: number | null }`
  - `interface CprLead { id: string; batch_id: string; category: string | null; offer: string /* label */ }`
  - `interface CprEvent { lead_id: string; kind: string; at: string; noop?: boolean }` (kinds used: `email_sent`, `contact_form_sent`, `call_placed`, `email_reply`, `call_qualified`)
  - `interface CprRow { key: string; found: number; contacted: number; emails: number; replies: number; rate: number | null; interested_calls: number; spend: number; cost_per_reply: number | null }`
  - `costPerReply(o: { batches: CprBatch[]; leads: CprLead[]; events: CprEvent[]; formUsd: Map<string, number>; groupBy: GroupBy; since: string | null; periods: { from: string; to: string }[] }): CprRow[]` — sorted by spend desc
  - `loadCostPerReply(groupBy: GroupBy, days: 30 | 90 | null): Promise<CprRow[]>`

Rules (from the spec): batches filtered by `created_at >= since`; each lead's spend = batch estimate / number of the batch's leads (all leads, qualified or not) + `formUsd` for that lead; niche key = batch niche, except niche starting "Any " → lead category ("Unknown" when null); city key = batch city; offer key = the lead's offer label; events inside a test period ignored; `email_sent` with `noop` ignored; contacted = a lead with ≥1 counted `email_sent` / `contact_form_sent` / `call_placed`; replies = leads with ≥1 counted `email_reply` (once per lead); interested_calls = leads with ≥1 counted `call_qualified`; rate = replies / contacted (null when contacted 0); cost_per_reply = spend / replies (null when replies 0). The loader pages through leads / events in 1000s, reads `contact_form_runs.usd` summed per lead, and passes `testPeriods(await getTestMode(), new Date())`.

- [ ] **Step 1: Failing tests**

```ts
const B = (id: string, niche: string, est: number | null, created_at = "2026-11-20T00:00:00Z"): CprBatch => ({ id, niche, city: "Austin, TX", created_at, estimated_cost_usd: est });
const L = (id: string, batch_id: string, category: string | null = "Plumber", offer = "Build a website"): CprLead => ({ id, batch_id, category, offer });
const E = (lead_id: string, kind: string, at = "2026-11-21T00:00:00Z", noop = false): CprEvent => ({ lead_id, kind, at, noop });
const base = { formUsd: new Map<string, number>(), groupBy: "niche" as const, since: null, periods: [] };

it("splits the batch estimate over all its leads and divides by replies", () => {
  const rows = costPerReply({ ...base, batches: [B("b1", "plumbers", 10)], leads: [L("a", "b1"), L("b", "b1"), L("c", "b1"), L("d", "b1")],
    events: [E("a", "email_sent"), E("b", "email_sent"), E("a", "email_reply"), E("a", "email_reply")] });
  expect(rows).toEqual([{ key: "plumbers", found: 4, contacted: 2, emails: 2, replies: 1, rate: 0.5, interested_calls: 0, spend: 10, cost_per_reply: 10 }]);
});
it("no replies or no cost never divides by zero", () => {
  const [r] = costPerReply({ ...base, batches: [B("b1", "x", null)], leads: [L("a", "b1")], events: [E("a", "email_sent")] });
  expect(r.spend).toBe(0);
  expect(r.cost_per_reply).toBeNull();
  expect(costPerReply({ ...base, batches: [B("b2", "y", 5)], leads: [], events: [] })).toEqual([]);
});
it("ignores activity inside a test period and sends that never went out", () => {
  const [r] = costPerReply({ ...base, periods: [{ from: "2026-11-26T00:00:00Z", to: "2026-12-10T00:00:00Z" }],
    batches: [B("b1", "x", 2)], leads: [L("a", "b1"), L("b", "b1")],
    events: [E("a", "email_sent", "2026-11-27T00:00:00Z"), E("a", "email_reply", "2026-11-28T00:00:00Z"), E("b", "email_sent", "2026-11-21T00:00:00Z", true)] });
  expect([r.contacted, r.replies, r.emails]).toEqual([0, 0, 0]);
});
it("'Any' niche batches group by the lead's category; offer and city grouping; forms add real cost", () => {
  const batches = [B("b1", "Any trades", 4)];
  const leads = [L("a", "b1", "Plumber"), L("b", "b1", "Electrician", "Redesign"), L("c", "b1", null)];
  expect(costPerReply({ ...base, batches, leads, events: [] }).map((r) => r.key).sort()).toEqual(["Electrician", "Plumber", "Unknown"]);
  expect(costPerReply({ ...base, groupBy: "offer", batches, leads, events: [] }).map((r) => r.key).sort()).toEqual(["Build a website", "Redesign"]);
  const [c] = costPerReply({ ...base, groupBy: "city", batches, leads, events: [E("a", "contact_form_sent"), E("a", "call_qualified")], formUsd: new Map([["a", 0.25]]) });
  expect(c).toMatchObject({ key: "Austin, TX", contacted: 1, interested_calls: 1, spend: 4.25 });
});
it("since filters by batch creation date", () => {
  const rows = costPerReply({ ...base, since: "2026-11-25T00:00:00Z", batches: [B("old", "x", 1, "2026-11-01T00:00:00Z"), B("new", "y", 1, "2026-11-26T00:00:00Z")], leads: [L("a", "old"), L("b", "new")], events: [] });
  expect(rows.map((r) => r.key)).toEqual(["y"]);
});
```

- [ ] **Step 2: Run** `npx vitest run lib/analytics/cost-per-reply.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the pure module, loader, component, page section (title "Cost per reply"; one line under it: "Spend is estimated: each batch's estimate shared over its leads, plus contact form costs. AI call minutes and email sending aren't included. Anything done while Test mode was on is left out."), and the docs. Money shown as `$0.00`, rate as `%`.
- [ ] **Step 4: Run** `npx vitest run lib/analytics` — Expected: PASS. `npm test` (whole suite) — Expected: all pass. `npm run typecheck` and `npm run lint` — clean.
- [ ] **Step 5: Commit** `feat(web): cost per reply by niche, city and offer on analytics`.
