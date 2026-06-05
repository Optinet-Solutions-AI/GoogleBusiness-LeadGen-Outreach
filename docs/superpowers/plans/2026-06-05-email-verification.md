# Email Verification System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify a lead's email through a layered ladder (free local checks → ZeroBounce/MillionVerifier/Hunter) and gate sends on the verdict, to protect sender reputation.

**Architecture:** A pure-ish `email-validator` library runs stages in order and short-circuits on a definitive 4-value verdict (`valid · invalid · catch-all · unknown`) with a no-guessing rule. Paid tiers are env-gated. Batch verification runs as a Cloud Run job (`MODE=verify`); a ≤5-lead inline endpoint handles quick re-checks. An opt-in gate in stage-5-email + campaign launch blocks `invalid` and holds `unknown`/`null`. Port 25 is blocked on Vercel/Cloud Run, so the SMTP stages no-op in prod and ZeroBounce is the workhorse.

**Tech Stack:** TypeScript, Next.js (web/), Supabase, vitest, `node:dns/promises`, `nodemailer`-free raw SMTP via `node:net` (probe), Cloud Run job runner.

**Spec:** `docs/superpowers/specs/2026-06-05-email-verification-design.md`

**Conventions (match the codebase):**
- Services import `{ env }` from `@/lib/config`, `{ getLogger }` from `@/lib/logger`, `{ retry }` from `@/lib/retry`. A `headers()` throws on a missing key. External calls wrapped in `retry`.
- Tests are co-located `*.test.ts`; run a single file with `npx vitest run <path>` (the `npm run test -- <path>` form mangles the path on PowerShell).
- Routes use `withApi` + `ok`/`fail` from `@/lib/response`, `isDbConfigured` + `getDb`.
- Commit messages: Conventional Commits, end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File map

**Create:**
- `web/lib/services/email-validator/types.ts` — `VerifyStatus`, `VerifyResult`, `StageResult`.
- `web/lib/services/email-validator/syntax-check.ts` — stage 1.
- `web/lib/services/email-validator/dns-check.ts` — stage 2 (MX + provider classify).
- `web/lib/services/email-validator/smtp-probe.ts` — stage 4 (raw SMTP RCPT; no-op when blocked).
- `web/lib/services/email-validator/catch-all-probe.ts` — stage 3 (uses smtp-probe against a random local-part).
- `web/lib/services/email-validator/email-verifier.zerobounce.ts` — stage 5.
- `web/lib/services/email-validator/email-verifier.millionverifier.ts` — stage 6.
- `web/lib/services/email-validator/email-verifier.hunter.ts` — stage 7.
- `web/lib/services/email-validator/index.ts` — `verifyEmail()` orchestrator.
- `web/lib/verify/verify-lead.ts` — persist a verdict to a lead + domain cache.
- `web/app/api/verify/route.ts` — POST trigger (Cloud Run job).
- `web/app/api/verify/sync/route.ts` — POST inline (≤5 leads).
- `web/scripts/verify-leads.ts` — CLI batch runner.
- `db/migrations/029_email_verification.sql`.
- Co-located `*.test.ts` for: syntax-check, dns-check, the 3 verifier mappers, index (orchestrator), verify-lead gate logic.

**Modify:**
- `web/lib/config.ts` — add env vars.
- `.env.example` — document them.
- `db/schema.sql` — port migration 029.
- `web/scripts/cloud-run-job.ts` — add `MODE=verify`.
- `web/package.json` — add `verify:leads` script.
- `web/lib/pipeline/stage-5-email.ts` — gate before send.
- `web/app/api/campaigns/[id]/launch/route.ts` — gate per member.
- `web/app/(dashboard)/leads/page.tsx` + `web/lib/leads-filter.ts` — verification filter.
- `web/components/LeadsTable.tsx` — verdict chip column.
- `web/app/(dashboard)/leads/[id]/page.tsx` — audit trail + re-verify.

---

## Phase 1 — Core ladder library

### Task 1: Config env vars

**Files:** Modify `web/lib/config.ts`; Modify `.env.example`

- [ ] **Step 1: Add keys to the zod schema.** In `web/lib/config.ts`, inside `Schema = z.object({...})`, after the `STRIPE_*` block, add:

```ts
  // Email verification ladder. ZeroBounce is the production workhorse (Vercel +
  // Cloud Run block port 25, so the free SMTP probe no-ops in prod). Each paid
  // key is env-gated: unset → that stage is skipped. The send-gate only turns on
  // when ZEROBOUNCE_API_KEY is set.
  ZEROBOUNCE_API_KEY: z.string().default(""),
  MILLIONVERIFIER_API_KEY: z.string().default(""),
  HUNTER_API_KEY: z.string().default(""),
  HUNTER_MAX_CALLS_PER_HOUR: z.coerce.number().default(20),
  SMTP_PROBE_HELO: z.string().default("optiratesolutions.com"),
  SMTP_PROBE_FROM: z.string().default("verify@optiratesolutions.com"),
```

- [ ] **Step 2: Document in `.env.example`.** Append:

```
# --- Email verification (optional; gate is off until ZEROBOUNCE_API_KEY is set) ---
ZEROBOUNCE_API_KEY=
MILLIONVERIFIER_API_KEY=
HUNTER_API_KEY=
HUNTER_MAX_CALLS_PER_HOUR=20
SMTP_PROBE_HELO=optiratesolutions.com
SMTP_PROBE_FROM=verify@optiratesolutions.com
```

- [ ] **Step 3: Typecheck.** Run: `npm --prefix web run typecheck` — Expected: clean.
- [ ] **Step 4: Commit.**

```bash
git add web/lib/config.ts .env.example
git commit -m "feat(config): add email-verification env vars"
```

### Task 2: Types + syntax check

**Files:** Create `web/lib/services/email-validator/types.ts`, `syntax-check.ts`, `syntax-check.test.ts`

- [ ] **Step 1: Write `types.ts`.**

```ts
/**
 * types.ts — shared types for the email-verification ladder.
 */
export type VerifyStatus = "valid" | "invalid" | "catch-all" | "unknown";

export interface StageResult {
  status: VerifyStatus;
  /** true when the stage produced a definitive answer the orchestrator can stop on. */
  decisive: boolean;
}

export interface VerifyResult {
  email: string;
  status: VerifyStatus;
  /** Which stage produced the final verdict, e.g. "syntax" | "mx" | "zerobounce". */
  decided_by: string;
  audit: {
    syntax_ok: boolean | null;
    mx_ok: boolean | null;
    smtp_result: string | null;
    zerobounce_result: string | null;
  };
}
```

- [ ] **Step 2: Write the failing test** `syntax-check.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkSyntax } from "./syntax-check";

describe("checkSyntax", () => {
  it("accepts a normal address", () => {
    expect(checkSyntax("jane@example.com").status).toBe("unknown"); // syntax OK → defer
    expect(checkSyntax("jane@example.com").decisive).toBe(false);
  });
  it("rejects malformed addresses", () => {
    for (const bad of ["", "no-at", "a@b", "a@@b.com", "a b@c.com", "a@b.c "]) {
      const r = checkSyntax(bad);
      expect(r.status).toBe("invalid");
      expect(r.decisive).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run it, expect FAIL** (`checkSyntax` not defined). Run: `npx vitest run web/lib/services/email-validator/syntax-check.test.ts`
- [ ] **Step 4: Implement `syntax-check.ts`.**

```ts
/**
 * syntax-check.ts — stage 1: free, instant RFC-ish syntax gate.
 * Syntax OK is NOT proof of deliverability → returns unknown/non-decisive.
 */
import type { StageResult } from "./types";

// Pragmatic address regex: local@domain.tld, no spaces, a real TLD label.
const RE = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/;

export function checkSyntax(email: string): StageResult {
  const ok = RE.test(email.trim());
  return ok ? { status: "unknown", decisive: false } : { status: "invalid", decisive: true };
}
```

- [ ] **Step 5: Run test, expect PASS.**
- [ ] **Step 6: Commit.** `git add web/lib/services/email-validator/ && git commit -m "feat(verify): syntax-check stage + types"`

### Task 3: DNS / MX check

**Files:** Create `web/lib/services/email-validator/dns-check.ts`, `dns-check.test.ts`

- [ ] **Step 1: Failing test** (`dns-check.test.ts`) — inject the resolver so the test is hermetic:

```ts
import { describe, it, expect } from "vitest";
import { checkMx, classifyProvider } from "./dns-check";

describe("classifyProvider", () => {
  it("detects google + outlook + other", () => {
    expect(classifyProvider("aspmx.l.google.com")).toBe("google_workspace");
    expect(classifyProvider("foo.mail.protection.outlook.com")).toBe("outlook365");
    expect(classifyProvider("mail.acme.com")).toBe("cpanel_or_other");
  });
});

describe("checkMx", () => {
  it("invalid when no MX records", async () => {
    const r = await checkMx("example.com", async () => []);
    expect(r.status).toBe("invalid");
    expect(r.decisive).toBe(true);
  });
  it("non-decisive unknown when MX exists", async () => {
    const r = await checkMx("example.com", async () => [{ exchange: "mail.acme.com", priority: 10 }]);
    expect(r.status).toBe("unknown");
    expect(r.decisive).toBe(false);
    expect(r.mxTop).toBe("mail.acme.com");
    expect(r.providerType).toBe("cpanel_or_other");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run web/lib/services/email-validator/dns-check.test.ts`
- [ ] **Step 3: Implement `dns-check.ts`.**

```ts
/**
 * dns-check.ts — stage 2: MX lookup (free). No MX → invalid. MX present →
 * unknown (defer) + the top MX host and a coarse provider classification used
 * later to decide whether an SMTP probe is worthwhile.
 */
import { resolveMx } from "node:dns/promises";
import type { StageResult } from "./types";

export type ProviderType = "google_workspace" | "outlook365" | "cpanel_or_other";

export function classifyProvider(mxTop: string): ProviderType {
  const h = mxTop.toLowerCase();
  if (h.includes("google.com") || h.includes("googlemail")) return "google_workspace";
  if (h.includes("outlook.com") || h.includes("protection.outlook")) return "outlook365";
  return "cpanel_or_other";
}

export interface MxResult extends StageResult {
  mxTop: string | null;
  providerType: ProviderType | null;
}

type Resolver = (domain: string) => Promise<{ exchange: string; priority: number }[]>;

export async function checkMx(domain: string, resolver: Resolver = resolveMx): Promise<MxResult> {
  let records: { exchange: string; priority: number }[] = [];
  try {
    records = await resolver(domain);
  } catch {
    records = [];
  }
  if (records.length === 0) {
    return { status: "invalid", decisive: true, mxTop: null, providerType: null };
  }
  const mxTop = records.sort((a, b) => a.priority - b.priority)[0].exchange;
  return {
    status: "unknown",
    decisive: false,
    mxTop,
    providerType: classifyProvider(mxTop),
  };
}
```

- [ ] **Step 4: Run test, expect PASS.**
- [ ] **Step 5: Commit.** `git commit -am "feat(verify): dns/mx stage + provider classify"`

### Task 4: ZeroBounce verifier (+ mapping)

**Files:** Create `email-verifier.zerobounce.ts`, `email-verifier.zerobounce.test.ts`

- [ ] **Step 1: Failing test** — test the pure `mapZeroBounce` mapper (table-driven from the spec):

```ts
import { describe, it, expect } from "vitest";
import { mapZeroBounce } from "./email-verifier.zerobounce";

describe("mapZeroBounce", () => {
  const cases: [string, string | undefined, string][] = [
    ["valid", undefined, "valid"],
    ["invalid", undefined, "invalid"],
    ["catch-all", undefined, "catch-all"],
    ["spamtrap", undefined, "invalid"],
    ["abuse", undefined, "invalid"],
    ["toxic", undefined, "unknown"],
    ["do_not_mail", "other", "catch-all"],
    ["do_not_mail", "global_suppression", "invalid"],
    ["do_not_mail", "possible_trap", "invalid"],
    ["unknown", undefined, "unknown"],
  ];
  it.each(cases)("%s/%s → %s", (status, sub, expected) => {
    expect(mapZeroBounce(status, sub)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `email-verifier.zerobounce.ts`.**

```ts
/**
 * email-verifier.zerobounce.ts — stage 5 (primary paid). Maps ZB's taxonomy to
 * our 4-value verdict, conservatively (never upgrade to valid without proof).
 */
import { env } from "../../config";
import { getLogger } from "../../logger";
import { retry } from "../../retry";
import type { VerifyStatus } from "./types";

const log = getLogger("verify.zerobounce");
const BASE = "https://api.zerobounce.net/v2";

export function mapZeroBounce(status: string, subStatus?: string): VerifyStatus {
  switch (status) {
    case "valid": return "valid";
    case "invalid": return "invalid";
    case "catch-all": return "catch-all";
    case "spamtrap":
    case "abuse": return "invalid";
    case "toxic": return "unknown";
    case "do_not_mail":
      return subStatus === "global_suppression" || subStatus === "possible_trap" ? "invalid" : "catch-all";
    default: return "unknown";
  }
}

/** Returns the mapped verdict + the raw ZB status (for the audit trail). Null when no key. */
export async function verifyZeroBounce(
  email: string,
): Promise<{ status: VerifyStatus; raw: string } | null> {
  if (!env.ZEROBOUNCE_API_KEY) return null;
  const url = `${BASE}/validate?api_key=${env.ZEROBOUNCE_API_KEY}&email=${encodeURIComponent(email)}`;
  const resp = await retry(() => fetch(url), { maxAttempts: 3 });
  if (!resp.ok) {
    log.warn({ email, status: resp.status }, "zerobounce.http_error");
    return { status: "unknown", raw: `http_${resp.status}` };
  }
  const data = (await resp.json()) as { status?: string; sub_status?: string };
  const raw = data.status ?? "unknown";
  return { status: mapZeroBounce(raw, data.sub_status), raw };
}
```

- [ ] **Step 4: Run test, expect PASS.**
- [ ] **Step 5: Commit.** `git commit -am "feat(verify): zerobounce verifier + mapping"`

### Task 5: MillionVerifier (Tier 2)

**Files:** Create `email-verifier.millionverifier.ts`, `email-verifier.millionverifier.test.ts`

- [ ] **Step 1: Failing test** for `mapMillionVerifier`:

```ts
import { describe, it, expect } from "vitest";
import { mapMillionVerifier } from "./email-verifier.millionverifier";

describe("mapMillionVerifier", () => {
  it.each([
    ["ok", "valid"],
    ["invalid", "invalid"],
    ["catch_all", "catch-all"],
    ["disposable", "unknown"],
    ["unknown", "unknown"],
    ["", "unknown"],
  ] as [string, string][])("%s → %s", (r, exp) => {
    expect(mapMillionVerifier(r)).toBe(exp);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `email-verifier.millionverifier.ts`.**

```ts
/**
 * email-verifier.millionverifier.ts — stage 6 (Tier 2). Fires only on unknown + key set.
 */
import { env } from "../../config";
import { getLogger } from "../../logger";
import { retry } from "../../retry";
import type { VerifyStatus } from "./types";

const log = getLogger("verify.millionverifier");
const BASE = "https://api.millionverifier.com/api/v3";

export function mapMillionVerifier(result: string): VerifyStatus {
  switch (result) {
    case "ok": return "valid";
    case "invalid": return "invalid";
    case "catch_all": return "catch-all";
    case "disposable": return "unknown";
    default: return "unknown";
  }
}

export async function verifyMillionVerifier(
  email: string,
): Promise<{ status: VerifyStatus; raw: string } | null> {
  if (!env.MILLIONVERIFIER_API_KEY) return null;
  const url = `${BASE}/?api=${env.MILLIONVERIFIER_API_KEY}&email=${encodeURIComponent(email)}`;
  const resp = await retry(() => fetch(url), { maxAttempts: 3 });
  if (!resp.ok) {
    log.warn({ email, status: resp.status }, "millionverifier.http_error");
    return { status: "unknown", raw: `http_${resp.status}` };
  }
  const data = (await resp.json()) as { result?: string };
  const raw = data.result ?? "unknown";
  return { status: mapMillionVerifier(raw), raw };
}
```

- [ ] **Step 4: Run, expect PASS.** **Step 5: Commit** `git commit -am "feat(verify): millionverifier tier"`

### Task 6: Hunter (Tier 3) with webmail-skip + hourly cap

**Files:** Create `email-verifier.hunter.ts`, `email-verifier.hunter.test.ts`

- [ ] **Step 1: Failing test** for the pure helpers:

```ts
import { describe, it, expect } from "vitest";
import { mapHunter, isWebmail } from "./email-verifier.hunter";

describe("hunter helpers", () => {
  it("isWebmail", () => {
    expect(isWebmail("a@gmail.com")).toBe(true);
    expect(isWebmail("a@acme.com")).toBe(false);
  });
  it.each([
    ["invalid", "undeliverable", "invalid"],
    ["valid", "deliverable", "valid"],
    ["accept_all", "risky", "catch-all"],
    ["webmail", "risky", "unknown"],
  ] as [string, string, string][])("%s/%s → %s", (status, result, exp) => {
    expect(mapHunter(status, result)).toBe(exp);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `email-verifier.hunter.ts`.**

```ts
/**
 * email-verifier.hunter.ts — stage 7 (last resort). Skips free-webmail domains
 * (the call adds nothing, burns a credit) + a per-process hourly cap.
 */
import { env } from "../../config";
import { getLogger } from "../../logger";
import { retry } from "../../retry";
import type { VerifyStatus } from "./types";

const log = getLogger("verify.hunter");
const BASE = "https://api.hunter.io/v2/email-verifier";
const WEBMAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com"]);

let windowStart = 0; // epoch ms of the current hour window
let callsThisHour = 0;

export function isWebmail(email: string): boolean {
  return WEBMAIL.has((email.split("@")[1] ?? "").toLowerCase());
}

export function mapHunter(status: string, result: string): VerifyStatus {
  if (status === "invalid" || result === "undeliverable") return "invalid";
  if (status === "accept_all") return "catch-all";
  if (status === "valid" && result === "deliverable") return "valid";
  return "unknown";
}

export async function verifyHunter(
  email: string,
  now: number = Date.now(),
): Promise<{ status: VerifyStatus; raw: string } | null> {
  if (!env.HUNTER_API_KEY || isWebmail(email)) return null;
  if (now - windowStart > 3_600_000) { windowStart = now; callsThisHour = 0; }
  if (callsThisHour >= env.HUNTER_MAX_CALLS_PER_HOUR) {
    log.warn({ email }, "hunter.hourly_cap");
    return null;
  }
  callsThisHour += 1;
  const url = `${BASE}?email=${encodeURIComponent(email)}&api_key=${env.HUNTER_API_KEY}`;
  const resp = await retry(() => fetch(url), { maxAttempts: 2 });
  if (!resp.ok) return { status: "unknown", raw: `http_${resp.status}` };
  const data = (await resp.json()) as { data?: { status?: string; result?: string } };
  const status = data.data?.status ?? "unknown";
  const result = data.data?.result ?? "unknown";
  return { status: mapHunter(status, result), raw: `${status}/${result}` };
}
```

- [ ] **Step 4: Run, expect PASS.** **Step 5: Commit** `git commit -am "feat(verify): hunter tier + webmail-skip + cap"`

### Task 7: SMTP probe + catch-all probe (port-25; no-op when blocked)

**Files:** Create `smtp-probe.ts`, `catch-all-probe.ts`, `smtp-probe.test.ts`

> These do real work only on a host with port 25 open (local backfill). In prod they time out → `unknown`. The test only covers the disabled/blocked path (no live socket in CI).

- [ ] **Step 1: Failing test** (`smtp-probe.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { smtpProbe } from "./smtp-probe";

describe("smtpProbe", () => {
  it("returns unknown (non-decisive) when probing is disabled", async () => {
    const r = await smtpProbe("a@acme.com", "mail.acme.com", { enabled: false });
    expect(r.status).toBe("unknown");
    expect(r.decisive).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `smtp-probe.ts`** (raw socket; bounded timeout; any error → unknown):

```ts
/**
 * smtp-probe.ts — stage 4: HELO → MAIL FROM → RCPT TO → QUIT (never DATA).
 * Port 25 is blocked on Vercel/Cloud Run, so this no-ops to unknown there; it
 * only resolves valid/invalid on a host with port 25 open (local backfill).
 */
import net from "node:net";
import { env } from "../../config";
import type { StageResult } from "./types";

const TIMEOUT_MS = 7000;

export async function smtpProbe(
  email: string,
  mxHost: string,
  opts: { enabled?: boolean } = {},
): Promise<StageResult & { raw: string }> {
  if (opts.enabled === false) return { status: "unknown", decisive: false, raw: "disabled" };
  return new Promise((resolve) => {
    const socket = net.createConnection(25, mxHost);
    let step = 0;
    const done = (status: StageResult["status"], decisive: boolean, raw: string) => {
      try { socket.write("QUIT\r\n"); socket.end(); } catch { /* noop */ }
      resolve({ status, decisive, raw });
    };
    socket.setTimeout(TIMEOUT_MS, () => done("unknown", false, "timeout"));
    socket.on("error", () => done("unknown", false, "error"));
    socket.on("data", (buf) => {
      const line = buf.toString();
      const code = parseInt(line.slice(0, 3), 10);
      if (step === 0) { socket.write(`HELO ${env.SMTP_PROBE_HELO}\r\n`); step = 1; return; }
      if (step === 1) { socket.write(`MAIL FROM:<${env.SMTP_PROBE_FROM}>\r\n`); step = 2; return; }
      if (step === 2) { socket.write(`RCPT TO:<${email}>\r\n`); step = 3; return; }
      if (step === 3) {
        if (code === 250 || code === 251) return done("valid", true, `rcpt_${code}`);
        if (code >= 500) return done("invalid", true, `rcpt_${code}`);
        return done("unknown", false, `rcpt_${code}`);
      }
    });
  });
}
```

- [ ] **Step 4: Implement `catch-all-probe.ts`** (probe a random local-part; a `250` means the domain accepts anything):

```ts
/**
 * catch-all-probe.ts — stage 3: does the domain accept a random mailbox? A 250
 * for a guaranteed-nonexistent local-part = catch-all. No-ops to unknown when
 * port 25 is blocked. Caller caches the answer per-domain (7 days).
 */
import { smtpProbe } from "./smtp-probe";
import type { StageResult } from "./types";

export async function catchAllProbe(
  domain: string,
  mxHost: string,
  opts: { enabled?: boolean } = {},
): Promise<StageResult & { raw: string }> {
  const random = `verify-probe-${Math.random().toString(36).slice(2, 12)}@${domain}`;
  const r = await smtpProbe(random, mxHost, opts);
  // A "valid" verdict for a random address means the domain accepts everything.
  if (r.status === "valid") return { status: "catch-all", decisive: true, raw: "accepts_random" };
  return { status: "unknown", decisive: false, raw: r.raw };
}
```

> Note: `Math.random()` is fine here (runtime code, not a workflow script).

- [ ] **Step 5: Run test, expect PASS.** **Step 6: Commit** `git commit -am "feat(verify): smtp + catch-all probes (port-25, no-op in prod)"`

### Task 8: Orchestrator (`index.ts`)

**Files:** Create `index.ts`, `index.test.ts`

- [ ] **Step 1: Failing test** — inject stage functions so it's hermetic:

```ts
import { describe, it, expect, vi } from "vitest";
import { runLadder } from "./index";

const stages = (over: Partial<Parameters<typeof runLadder>[1]>) => ({
  syntax: () => ({ status: "unknown" as const, decisive: false }),
  mx: async () => ({ status: "unknown" as const, decisive: false, mxTop: "mx.acme.com", providerType: "cpanel_or_other" as const }),
  catchAll: async () => ({ status: "unknown" as const, decisive: false, raw: "disabled" }),
  smtp: async () => ({ status: "unknown" as const, decisive: false, raw: "disabled" }),
  zerobounce: async () => null,
  millionverifier: async () => null,
  hunter: async () => null,
  ...over,
});

describe("runLadder", () => {
  it("short-circuits on invalid syntax", async () => {
    const r = await runLadder("bad", stages({ syntax: () => ({ status: "invalid", decisive: true }) }));
    expect(r.status).toBe("invalid");
    expect(r.decided_by).toBe("syntax");
  });
  it("uses ZeroBounce when local stages are unknown", async () => {
    const r = await runLadder("a@acme.com", stages({ zerobounce: async () => ({ status: "valid", raw: "valid" }) }));
    expect(r.status).toBe("valid");
    expect(r.decided_by).toBe("zerobounce");
  });
  it("never upgrades to valid without proof (stays unknown)", async () => {
    const r = await runLadder("a@acme.com", stages({}));
    expect(r.status).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `index.ts`.** The injectable `runLadder` does the logic; `verifyEmail` wires the real stages.

```ts
/**
 * index.ts — the verification ladder. Runs cheap stages first, short-circuits on
 * a decisive verdict, falls through to paid verifiers, and never upgrades to
 * `valid` without explicit proof.
 */
import { env } from "../../config";
import { getLogger } from "../../logger";
import { checkSyntax } from "./syntax-check";
import { checkMx, type MxResult } from "./dns-check";
import { catchAllProbe } from "./catch-all-probe";
import { smtpProbe } from "./smtp-probe";
import { verifyZeroBounce } from "./email-verifier.zerobounce";
import { verifyMillionVerifier } from "./email-verifier.millionverifier";
import { verifyHunter } from "./email-verifier.hunter";
import type { StageResult, VerifyResult, VerifyStatus } from "./types";

const log = getLogger("verify.ladder");

export interface LadderStages {
  syntax: (email: string) => StageResult;
  mx: (domain: string) => Promise<MxResult>;
  catchAll: (domain: string, mx: string) => Promise<StageResult & { raw: string }>;
  smtp: (email: string, mx: string) => Promise<StageResult & { raw: string }>;
  zerobounce: (email: string) => Promise<{ status: VerifyStatus; raw: string } | null>;
  millionverifier: (email: string) => Promise<{ status: VerifyStatus; raw: string } | null>;
  hunter: (email: string) => Promise<{ status: VerifyStatus; raw: string } | null>;
}

export async function runLadder(email: string, s: LadderStages): Promise<VerifyResult> {
  const audit: VerifyResult["audit"] = {
    syntax_ok: null, mx_ok: null, smtp_result: null, zerobounce_result: null,
  };
  const finalize = (status: VerifyStatus, decided_by: string): VerifyResult =>
    ({ email, status, decided_by, audit });

  const syn = s.syntax(email);
  audit.syntax_ok = syn.status !== "invalid";
  if (syn.decisive) return finalize(syn.status, "syntax");

  const domain = email.split("@")[1] ?? "";
  const mx = await s.mx(domain);
  audit.mx_ok = mx.status !== "invalid";
  if (mx.decisive) return finalize(mx.status, "mx");
  const mxHost = mx.mxTop ?? "";

  // SMTP-based stages are skippable for the "giants" (they 250 everything → a
  // probe verdict would be a guess); those fall straight through to ZeroBounce.
  const giant = mx.providerType === "google_workspace" || mx.providerType === "outlook365";
  if (!giant && mxHost) {
    const ca = await s.catchAll(domain, mxHost);
    if (ca.decisive) { audit.smtp_result = ca.raw; return finalize(ca.status, "catch-all"); }
    const probe = await s.smtp(email, mxHost);
    audit.smtp_result = probe.raw;
    if (probe.decisive) return finalize(probe.status, "smtp");
  }

  const zb = await s.zerobounce(email);
  if (zb) { audit.zerobounce_result = zb.raw; if (zb.status !== "unknown") return finalize(zb.status, "zerobounce"); }
  const mv = await s.millionverifier(email);
  if (mv && mv.status !== "unknown") return finalize(mv.status, "millionverifier");
  const hu = await s.hunter(email);
  if (hu && hu.status !== "unknown") return finalize(hu.status, "hunter");

  return finalize("unknown", "exhausted");
}

/** Production wiring. SMTP stages are enabled only when explicitly allowed (local backfill). */
export async function verifyEmail(
  email: string,
  opts: { smtpEnabled?: boolean } = {},
): Promise<VerifyResult> {
  const smtpEnabled = opts.smtpEnabled ?? false; // off in prod (port 25 blocked)
  const result = await runLadder(email, {
    syntax: checkSyntax,
    mx: checkMx,
    catchAll: (d, mx) => catchAllProbe(d, mx, { enabled: smtpEnabled }),
    smtp: (e, mx) => smtpProbe(e, mx, { enabled: smtpEnabled }),
    zerobounce: verifyZeroBounce,
    millionverifier: verifyMillionVerifier,
    hunter: verifyHunter,
  });
  log.info({ email, status: result.status, by: result.decided_by }, "verify.done");
  return result;
}

/** True when the send-gate should enforce (a paid verifier is configured). */
export function verificationActive(): boolean {
  return !!env.ZEROBOUNCE_API_KEY;
}
```

- [ ] **Step 4: Run test, expect PASS.**
- [ ] **Step 5: Full typecheck + lint.** Run: `npm --prefix web run typecheck` then `npm --prefix web run lint`. Expected: clean.
- [ ] **Step 6: Commit.** `git commit -am "feat(verify): ladder orchestrator (no-guessing, giant-skip)"`

---

## Phase 2 — Database

### Task 9: Migration 029 + schema.sql port

**Files:** Create `db/migrations/029_email_verification.sql`; Modify `db/schema.sql`

- [ ] **Step 1: Write `db/migrations/029_email_verification.sql`.**

```sql
-- 029_email_verification.sql
-- Email verification verdicts + a per-domain intel cache (catch-all/MX/provider).
-- House style: idempotent; RLS disabled (prod reads with a key subject to RLS).

create table if not exists domain_email_intel (
    domain        text primary key,
    mx_top        text,
    provider_type text,             -- google_workspace | outlook365 | cpanel_or_other
    is_catch_all  boolean,
    checked_at    timestamptz not null default now()
);
alter table if exists domain_email_intel disable row level security;

alter table if exists leads add column if not exists verification_status text;  -- valid|invalid|catch-all|unknown|null
alter table if exists leads add column if not exists email_verified boolean not null default false;
alter table if exists leads add column if not exists verified_at timestamptz;
alter table if exists leads add column if not exists verify_syntax_ok boolean;
alter table if exists leads add column if not exists verify_mx_ok boolean;
alter table if exists leads add column if not exists verify_smtp_result text;
alter table if exists leads add column if not exists verify_zerobounce_result text;
create index if not exists leads_verification_status_idx on leads (verification_status);
```

- [ ] **Step 2: Port the same statements into `db/schema.sql`** — add the `domain_email_intel` block near the other migration-028 social block, and add the seven `leads` columns to the `leads` table definition (or as trailing `alter`s consistent with house style there).

- [ ] **Step 3: Commit** (operator applies the migration in Supabase). `git add db/ && git commit -m "feat(db): migration 029 email verification (RLS off)"`

### Task 9b: Domain-intel cache (per-domain catch-all/MX, 7-day reuse)

**Files:** Create `web/lib/services/email-validator/domain-cache.ts`, `domain-cache.test.ts`; Modify `web/lib/services/email-validator/index.ts`

> The cache only changes behaviour when SMTP probing is enabled (local backfill) — it lets every lead on a domain cost **one** catch-all probe instead of N. In prod (port 25 blocked) the probe no-ops, so the cache is simply skipped. ZeroBounce is per-address and isn't cached.

- [ ] **Step 1: Failing test** (`domain-cache.test.ts`) for the freshness predicate (pure):

```ts
import { describe, it, expect } from "vitest";
import { isFresh } from "./domain-cache";

describe("isFresh", () => {
  const now = Date.parse("2026-06-05T00:00:00Z");
  it("fresh within 7 days", () => {
    expect(isFresh("2026-06-01T00:00:00Z", now)).toBe(true);
  });
  it("stale past 7 days", () => {
    expect(isFresh("2026-05-20T00:00:00Z", now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run web/lib/services/email-validator/domain-cache.test.ts`
- [ ] **Step 3: Implement `domain-cache.ts`.**

```ts
/**
 * domain-cache.ts — per-domain catch-all/MX intel, reused for 7 days. Only
 * meaningful when SMTP probing runs (local backfill); prod skips it.
 */
import { getDb } from "../../db";
import { getLogger } from "../../logger";

const log = getLogger("verify.domain-cache");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function isFresh(checkedAt: string, now: number = Date.now()): boolean {
  return now - Date.parse(checkedAt) < SEVEN_DAYS_MS;
}

export async function getDomainIntel(
  domain: string,
): Promise<{ is_catch_all: boolean | null; checked_at: string } | null> {
  const { data } = await getDb()
    .from("domain_email_intel")
    .select("is_catch_all,checked_at")
    .eq("domain", domain)
    .maybeSingle();
  if (!data || !isFresh(data.checked_at)) return null;
  return data as { is_catch_all: boolean | null; checked_at: string };
}

export async function putDomainIntel(domain: string, intel: {
  mx_top: string | null; provider_type: string | null; is_catch_all: boolean | null;
}): Promise<void> {
  await getDb()
    .from("domain_email_intel")
    .upsert({ domain, ...intel, checked_at: new Date().toISOString() }, { onConflict: "domain" })
    .then(({ error }) => { if (error) log.warn({ domain, err: error.message }, "domain-cache.put_failed"); });
}
```

- [ ] **Step 4: Wire into `index.ts` `verifyEmail`** — only on the `smtpEnabled` branch: before probing, `getDomainIntel(domain)`; if `is_catch_all === true` skip straight to a `catch-all` verdict; after a fresh probe, `putDomainIntel`. Leave `runLadder` (the injected, unit-tested core) untouched — the cache lives in the production `verifyEmail` wiring so the orchestrator stays pure/testable.
- [ ] **Step 5: Run test, expect PASS; typecheck.**
- [ ] **Step 6: Commit.** `git commit -am "feat(verify): per-domain intel cache (7-day reuse)"`

---

## Phase 3 — Execution (persist, job, CLI, endpoints)

### Task 10: `verify-lead.ts` — run + persist one lead

**Files:** Create `web/lib/verify/verify-lead.ts`, `verify-lead.test.ts`

- [ ] **Step 1: Failing test** — inject a fake db + a fake verifier, assert the right row update:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildLeadUpdate } from "./verify-lead";

describe("buildLeadUpdate", () => {
  it("maps a verify result to lead columns", () => {
    const u = buildLeadUpdate({
      email: "a@acme.com", status: "valid", decided_by: "zerobounce",
      audit: { syntax_ok: true, mx_ok: true, smtp_result: "disabled", zerobounce_result: "valid" },
    }, "2026-06-05T00:00:00Z");
    expect(u).toEqual({
      verification_status: "valid",
      email_verified: true,
      verified_at: "2026-06-05T00:00:00Z",
      verify_syntax_ok: true,
      verify_mx_ok: true,
      verify_smtp_result: "disabled",
      verify_zerobounce_result: "valid",
    });
  });
  it("email_verified is false for non-valid", () => {
    const u = buildLeadUpdate({ email: "x", status: "invalid", decided_by: "mx",
      audit: { syntax_ok: true, mx_ok: false, smtp_result: null, zerobounce_result: null } }, "t");
    expect(u.email_verified).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `verify-lead.ts`.**

```ts
/**
 * verify-lead.ts — verify one lead's email and persist the verdict + audit trail.
 * Inputs:  a lead { id, email }. Outputs: writes verification_* columns. Used by:
 * the Cloud Run verify job, the CLI, and /api/verify/sync.
 */
import { getDb } from "../db";
import { getLogger } from "../logger";
import { verifyEmail } from "../services/email-validator";
import type { VerifyResult } from "../services/email-validator/types";

const log = getLogger("verify-lead");

export function buildLeadUpdate(r: VerifyResult, verifiedAt: string) {
  return {
    verification_status: r.status,
    email_verified: r.status === "valid",
    verified_at: verifiedAt,
    verify_syntax_ok: r.audit.syntax_ok,
    verify_mx_ok: r.audit.mx_ok,
    verify_smtp_result: r.audit.smtp_result,
    verify_zerobounce_result: r.audit.zerobounce_result,
  };
}

export async function verifyLead(
  lead: { id: string; email: string | null },
  opts: { smtpEnabled?: boolean } = {},
): Promise<VerifyResult | null> {
  if (!lead.email) return null;
  const result = await verifyEmail(lead.email, opts).catch((e) => {
    log.warn({ lead_id: lead.id, err: String(e) }, "verify-lead.error");
    return null;
  });
  if (!result) return null;
  await getDb().from("leads").update(buildLeadUpdate(result, new Date().toISOString())).eq("id", lead.id);
  return result;
}
```

- [ ] **Step 4: Run test, expect PASS.** **Step 5: Commit** `git commit -am "feat(verify): verify-lead persist"`

### Task 11: Cloud Run `MODE=verify` + CLI

**Files:** Modify `web/scripts/cloud-run-job.ts`; Create `web/scripts/verify-leads.ts`; Modify `web/package.json`

- [ ] **Step 1: Add a shared batch fn to `verify-lead.ts`** (append):

```ts
/** Verify up to `limit` unverified leads (those with an email + no/false verdict). */
export async function verifyUnverifiedLeads(
  limit = 500,
  opts: { smtpEnabled?: boolean } = {},
): Promise<{ verified: number; byStatus: Record<string, number> }> {
  const { data } = await getDb()
    .from("leads")
    .select("id,email")
    .not("email", "is", null)
    .neq("email", "")
    .eq("email_verified", false)
    .limit(limit);
  const leads = (data ?? []) as { id: string; email: string | null }[];
  const byStatus: Record<string, number> = {};
  for (const lead of leads) {
    const r = await verifyLead(lead, opts);
    if (r) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }
  log.info({ verified: leads.length, byStatus }, "verify.batch.done");
  return { verified: leads.length, byStatus };
}
```

- [ ] **Step 2: Add `MODE=verify` to `web/scripts/cloud-run-job.ts`.** Extend the `Mode` union + `readMode` to include `"verify"`, import `verifyUnverifiedLeads`, and add the branch after the `queue` branch:

```ts
  if (mode === "verify") {
    const limit = process.env.VERIFY_LIMIT ? Number(process.env.VERIFY_LIMIT) : 500;
    log.info({ mode, limit }, "job.start");
    const summary = await verifyUnverifiedLeads(limit, { smtpEnabled: false });
    log.info({ mode, ...summary }, "job.done");
    return;
  }
```

(Also add `"verify"` to the doc comment header listing the modes.)

- [ ] **Step 3: Create `web/scripts/verify-leads.ts`** (CLI; `--smtp` enables the local probe):

```ts
/**
 * verify-leads.ts — CLI batch email verification.
 * Usage: npm run --prefix web verify:leads -- [--limit=500] [--smtp]
 * Pass --smtp on a host with port 25 open to enable the free RCPT/catch-all probe.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

import { verifyUnverifiedLeads } from "@/lib/verify/verify-lead";

async function main() {
  const args = process.argv.slice(2);
  const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 500);
  const smtpEnabled = args.includes("--smtp");
  const summary = await verifyUnverifiedLeads(limit, { smtpEnabled });
  console.log(JSON.stringify(summary, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Add the npm script** to `web/package.json` scripts:

```json
    "verify:leads": "tsx --tsconfig tsconfig.json scripts/verify-leads.ts",
```

- [ ] **Step 5: Typecheck.** `npm --prefix web run typecheck` — Expected: clean.
- [ ] **Step 6: Commit.** `git commit -am "feat(verify): cloud-run MODE=verify + verify-leads CLI"`

### Task 12: API routes — trigger + inline sync

**Files:** Create `web/app/api/verify/route.ts`, `web/app/api/verify/sync/route.ts`

- [ ] **Step 1: `web/app/api/verify/sync/route.ts`** (inline, ≤5 leads):

```ts
/**
 * api/verify/sync/route.ts — POST { leadIds: string[] } (≤5): verify now, inline.
 * For quick re-checks from the UI. Heavy batches go through the Cloud Run job.
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { isDbConfigured } from "@/lib/safe-db";
import { getDb } from "@/lib/db";
import { verifyLead } from "@/lib/verify/verify-lead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ leadIds: z.array(z.string().uuid()).min(1).max(5) });

export const POST = withApi(async (req) => {
  if (!isDbConfigured()) return fail("Supabase not configured", 503);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("leadIds (1–5 uuids) required", 400);
  const { data } = await getDb().from("leads").select("id,email").in("id", parsed.data.leadIds);
  const leads = (data ?? []) as { id: string; email: string | null }[];
  const results: Record<string, string> = {};
  for (const lead of leads) {
    const r = await verifyLead(lead);
    results[lead.id] = r?.status ?? "skipped";
  }
  return ok({ results });
});
```

- [ ] **Step 2: `web/app/api/verify/route.ts`** — trigger the Cloud Run job (reuse the existing batch-trigger helper if present; otherwise fall back to running a small inline batch). Inspect `web/app/api/batches/[id]/run/route.ts` for the exact Cloud Run trigger helper and mirror it with `MODE=verify`. Concretely:

```ts
/**
 * api/verify/route.ts — POST: kick off batch verification of unverified leads.
 * Triggers the Cloud Run job (MODE=verify), mirroring how batches are run.
 */
import { withApi } from "@/lib/api-wrap";
import { ok, fail } from "@/lib/response";
import { triggerCloudRunJob } from "@/lib/cloud-run-trigger"; // the same helper batches use
import { env } from "@/lib/config";

export const dynamic = "force-dynamic";

export const POST = withApi(async () => {
  if (!env.GCP_WORKLOAD_IDENTITY_PROVIDER) {
    return fail("Cloud Run trigger not configured — run `npm run verify:leads` instead.", 503);
  }
  await triggerCloudRunJob({ MODE: "verify" });
  return ok({ triggered: true });
});
```

> If no reusable `triggerCloudRunJob` helper exists, the implementer should locate the trigger code in the batches run route and extract/reuse it (do not duplicate). If the project triggers jobs only via the operator/CLI today, this route returns the 503 above and the CLI is the path — note that in the response.

- [ ] **Step 3: Typecheck + build.** `npm --prefix web run typecheck` then `npm --prefix web run build`. Expected: routes compile; `/api/verify` + `/api/verify/sync` listed.
- [ ] **Step 4: Commit.** `git commit -am "feat(verify): /api/verify trigger + /api/verify/sync inline"`

---

## Phase 4 — Send gate

### Task 13: Gate in stage-5-email + campaign launch

**Files:** Modify `web/lib/pipeline/stage-5-email.ts`; Modify `web/app/api/campaigns/[id]/launch/route.ts`; Create `web/lib/verify/gate.ts` + `gate.test.ts`

- [ ] **Step 1: Failing test** (`web/lib/verify/gate.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { sendDecision } from "./gate";

describe("sendDecision", () => {
  it("no-ops to send when verification inactive", () => {
    expect(sendDecision("invalid", false)).toBe("send"); // gate off
  });
  it("blocks invalid, holds unknown + null, sends valid + catch-all when active", () => {
    expect(sendDecision("valid", true)).toBe("send");
    expect(sendDecision("catch-all", true)).toBe("send");
    expect(sendDecision("invalid", true)).toBe("skip");
    expect(sendDecision("unknown", true)).toBe("hold");
    expect(sendDecision(null, true)).toBe("hold");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `web/lib/verify/gate.ts`.**

```ts
/**
 * gate.ts — should we send to this lead given its verification verdict?
 * Opt-in: when verification is inactive (no ZeroBounce key) everything sends.
 */
import type { VerifyStatus } from "../services/email-validator/types";

export type SendDecision = "send" | "skip" | "hold";

export function sendDecision(status: VerifyStatus | null, active: boolean): SendDecision {
  if (!active) return "send";
  if (status === "valid" || status === "catch-all") return "send";
  if (status === "invalid") return "skip";
  return "hold"; // unknown OR null (never verified)
}
```

- [ ] **Step 4: Run test, expect PASS.**
- [ ] **Step 5: Wire into `stage-5-email.ts`.** It already loads the lead. Widen the lead type to include `verification_status`, import `sendDecision` + `verificationActive`, and gate just before `sendOutreachEmail`:

```ts
import { sendDecision } from "../verify/gate";
import { verificationActive } from "../services/email-validator";
// ...after the suppression + already-sent guards, before renderOutreachEmail:
  const decision = sendDecision(
    (lead as { verification_status?: VerifyStatus | null }).verification_status ?? null,
    verificationActive(),
  );
  if (decision !== "send") {
    log.info({ lead_id: lead.id, decision }, "stage_5_email.gated");
    return { sent: false, skipped: "unverified" };
  }
```

Add `"unverified"` to the `EmailResult.skipped` union. Ensure the lead object passed in carries `verification_status` (widen the select in the callers that build the lead — `app/api/leads/[id]/email/route.ts` and the launch route).

- [ ] **Step 6: Wire into `campaigns/[id]/launch/route.ts`.** When selecting member leads to send, include `verification_status` in the select and apply `sendDecision`; tally `skipped` (invalid) + `held` (unknown/null) and include them in the launch summary so the operator sees how many need verifying.

- [ ] **Step 7: Typecheck + tests + build.** `npm --prefix web run typecheck`, `npx vitest run web/lib/verify/gate.test.ts`, `npm --prefix web run build`. Expected: clean.
- [ ] **Step 8: Commit.** `git commit -am "feat(verify): opt-in send gate (stage-5 + campaign launch)"`

---

## Phase 5 — UI

### Task 14: Leads verification filter + verdict chips + Verify action

**Files:** Modify `web/lib/leads-filter.ts`; Modify `web/app/(dashboard)/leads/page.tsx`; Modify `web/components/LeadsTable.tsx`; Create `web/components/VerifyLeadsButton.tsx`

- [ ] **Step 1: Extend `web/lib/leads-filter.ts`** with a verification filter mirroring `applyEmailFilter`:

```ts
export type VerifyFilter = "verified" | "unverified" | "invalid" | undefined;

export function parseVerifyFilter(v: string | null | undefined): VerifyFilter {
  return v === "verified" || v === "unverified" || v === "invalid" ? v : undefined;
}

export function applyVerifyFilter<Q>(query: Q, v: VerifyFilter): Q {
  const q = query as any;
  if (v === "verified") return q.eq("verification_status", "valid");
  if (v === "invalid") return q.eq("verification_status", "invalid");
  if (v === "unverified") return q.or("verification_status.is.null,verification_status.eq.unknown");
  return q;
}
```

> Match the existing file exactly: it uses a bare `const q = query as any;` with **no** eslint-disable comment — a disable for a rule this config doesn't define is itself a lint error (learned earlier in `leads-filter.ts`).

- [ ] **Step 2: Wire the filter into `leads/page.tsx`** — read `?verify=`, pass through `getLeads`/`applyVerifyFilter`, add a `Verification` pill row (`All · Verified · Unverified · Invalid`) using the existing `urlWith` helper, and add the coverage line a "verified" count via a cached count query (mirror `getEmailCoverage`). Pass `verifyFilter` to `LeadsTable` (so "Select all matching" includes it — also add `verify` to `/api/leads/ids`).

- [ ] **Step 3: Verdict chip in `LeadsTable.tsx`** — add `verification_status` to `LeadRow` + a small chip in the Email cell: `valid`→positive, `invalid`→urgent, `catch-all`→warning, `unknown`/null→muted.

- [ ] **Step 4: `VerifyLeadsButton.tsx`** (client) — a header action that `POST`s `/api/verify` and toasts the result (or, on 503, tells the operator to run the CLI). Render it in the Leads `PageHeader` actions.

- [ ] **Step 5: Typecheck + lint + build.** Expected: clean; `/leads` compiles.
- [ ] **Step 6: Commit.** `git commit -am "feat(web): leads verification filter + verdict chips + verify action"`

### Task 15: Lead-detail audit trail + re-verify

**Files:** Modify `web/app/(dashboard)/leads/[id]/page.tsx`; Create `web/components/ReverifyButton.tsx`

- [ ] **Step 1: Add the verdict + audit to the lead detail** — include the `verify_*` columns in the lead select (already `select(*)` was trimmed to explicit columns in the perf pass — add `verification_status,verify_syntax_ok,verify_mx_ok,verify_smtp_result,verify_zerobounce_result,verified_at`), and render a small "Email verification" card showing the verdict chip + the per-stage trail.

- [ ] **Step 2: `ReverifyButton.tsx`** (client) — `POST /api/verify/sync` with `{ leadIds: [id] }`, toast the new status, `router.refresh()`.

- [ ] **Step 3: Typecheck + lint + build.** Expected: clean.
- [ ] **Step 4: Commit.** `git commit -am "feat(web): lead-detail verification card + re-verify"`

---

## Final verification
- [ ] `npm --prefix web run typecheck` — clean.
- [ ] `npm --prefix web run lint` — clean (only the pre-existing VapiTestCall warning).
- [ ] `npx vitest run web/lib/services/email-validator web/lib/verify` — all green.
- [ ] `npm --prefix web run build` — compiles; `/api/verify`, `/api/verify/sync`, `/leads` present.
- [ ] Operator applies migration 029 in Supabase.
- [ ] Operator sets `ZEROBOUNCE_API_KEY` (Vercel + the Cloud Run job env) to activate the gate + paid stage. Deploy is a separate, explicit step.

## Notes for the implementer
- **Never burn paid APIs without confirmation.** The verifier calls cost money; during development, unit-test the *mappers* (pure) and stub the network — do not hit ZeroBounce/MillionVerifier/Hunter live without the operator's go-ahead.
- The SMTP stages will read `unknown` everywhere except a port-25-open host; that's expected.
- No client component may import `lib/db` or `lib/services/*` (server-only guard).
