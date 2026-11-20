/**
 * scripts/contact-form-dryrun.ts — EXPERIMENT: find each lead's contact page and
 * let OpenAI computer-use fill the form WITHOUT submitting it.
 *
 * Inputs:  --batch=<id>[,<id>...] (leads with a website_url), OPENAI_API_KEY,
 *          SUPABASE_URL/SUPABASE_SERVICE_KEY from the repo-root .env;
 *          optional --out=<dir> --concurrency=<n> --max-steps=<n> --lead=<id>
 *          --no-record; or --import-report=<report.json> to record a past run.
 * Outputs: per-lead screenshots + report.json in --out. Unless --no-record, each
 *          filled/blocked form is marked on the lead as an outreach_events row
 *          (contact_form_filled / contact_form_blocked, meta.sent=false) with its
 *          screenshot in Storage. NEVER submits a form (all non-GET requests
 *          aborted; submit clicks + Enter in inputs blocked in code).
 * Shares its browser helpers with lib/services/contact-form-browser.ts (the real send).
 * Used by: operator, manually (`npx tsx scripts/contact-form-dryrun.ts --batch=...`).
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
import fs from "node:fs";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type Browser, type Page } from "playwright";
import {
  BROWSER_UA,
  VIEW,
  collectFilled,
  findContactUrl,
  runAction,
  type ActionGuard,
} from "../lib/services/contact-form-browser";

/** Event kinds written to outreach_events. Must NOT end in "_sent" (KPIs count those as sends). */
const FILLED_KIND = "contact_form_filled";
const BLOCKED_KIND = "contact_form_blocked";
const BUCKET = "lead-screenshots";

const SENDER_NAME = "Chris";
const SENDER_EMAIL = "chris.albea30.dev@gmail.com";
const MESSAGE =
  "Hi, my name is Chris. We supply flooring (parquet, laminate and SPC) and decorative " +
  "wall finishes: wood, acoustic and slatted wall panels, PVC panels and marble-effect " +
  "panels. I would love to send you our catalog and trade pricing. Would that be of interest? " +
  `Best regards, Chris (${SENDER_EMAIL})`;

const MODEL = "gpt-6.1-sol";
function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

interface LeadRow {
  id: string;
  business_name: string;
  website_url: string | null;
  batch_id: string;
}

interface Result {
  lead_id: string;
  business_name: string;
  website_url: string | null;
  contact_url: string | null;
  outcome: string;
  steps: number;
  blocked_submit_attempts: number;
  aborted_requests: number;
  filled_fields: Array<{ name: string; value: string }>;
  model_summary: string | null;
  screenshot: string | null;
  error?: string;
}

async function shot(page: Page): Promise<string> {
  return (await page.screenshot({ type: "png" })).toString("base64");
}

/** OpenAI computer-use payloads are loosely documented, so they're handled untyped. */
type Json = any;

async function callOpenAI(body: unknown): Promise<Json> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    throw new Error(`openai ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }
  throw new Error("openai: retries exhausted");
}

async function fillOne(browser: Browser, lead: LeadRow, outDir: string, maxSteps: number): Promise<Result> {
  const r: Result = {
    lead_id: lead.id, business_name: lead.business_name, website_url: lead.website_url,
    contact_url: null, outcome: "pending", steps: 0, blocked_submit_attempts: 0,
    aborted_requests: 0, filled_fields: [], model_summary: null, screenshot: null,
  };
  const ctx = await browser.newContext({
    viewport: VIEW,
    userAgent: BROWSER_UA,
    serviceWorkers: "block", // they could answer requests the route guard never sees
  });
  // Dry run: the guard never leaves "fill", so every submit click / Enter in an input is refused.
  const guard: ActionGuard = {
    phase: "fill", host: null, submits: 0, blocked: 0,
    fillNote: "BLOCKED: that would submit the form. This is a dry run - do not submit.",
  };
  // HARD GUARD: nothing but GET/HEAD/OPTIONS leaves the browser, so a form can never be sent.
  await ctx.route("**/*", (route) => {
    const m = route.request().method();
    if (m === "GET" || m === "HEAD" || m === "OPTIONS") return route.continue();
    r.aborted_requests++;
    return route.abort();
  });
  const page = await ctx.newPage();
  try {
    if (!lead.website_url) {
      r.outcome = "no_website";
      return r;
    }
    r.contact_url = await findContactUrl(page, lead.website_url).catch((e) => {
      r.error = String(e).slice(0, 200);
      return null;
    });
    if (!r.contact_url) {
      r.outcome = r.error ? "site_unreachable" : "no_contact_page";
      return r;
    }
    await page.goto(r.contact_url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);

    const task =
      `You are on the contact page of "${lead.business_name}". Fill in its contact form as if sending them a message, ` +
      `but DO NOT click the submit/send button and DO NOT press Enter in single-line fields. This is a dry run and a human will review it.\n` +
      `Use: name "${SENDER_NAME}", email "${SENDER_EMAIL}". Leave phone and any field you have no true value for EMPTY (do not invent data). ` +
      `For a subject field use "Flooring & wall panel supply". Message:\n"${MESSAGE}"\n` +
      `If a dropdown asks for a reason/topic, pick the closest general or sales option. If there is a CAPTCHA, do not try to solve it. ` +
      `Close cookie banners or popups if they block the form. If there is no contact form on this page (e.g. only an address/map), stop. ` +
      `When every field you can fill is filled, stop and reply with one line: FILLED, NO_FORM, or BLOCKED:<reason>.`;

    let resp = await callOpenAI({
      model: MODEL,
      tools: [{ type: "computer" }],
      truncation: "auto",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: task },
            { type: "input_image", image_url: `data:image/png;base64,${await shot(page)}`, detail: "original" },
          ],
        },
      ],
    });

    while (r.steps < maxSteps) {
      const out: Json[] = resp.output ?? [];
      const calls = out.filter((o) => o.type === "computer_call");
      const msg = out
        .filter((o) => o.type === "message")
        .flatMap((m) => m.content ?? [])
        .map((c: Json) => c.text)
        .filter(Boolean)
        .join(" ");
      if (msg) r.model_summary = msg.slice(0, 300);
      if (!calls.length) break;
      const call = calls[0];
      if (call.pending_safety_checks?.length) {
        r.outcome = "safety_check_stop";
        r.model_summary = JSON.stringify(call.pending_safety_checks).slice(0, 300);
        break;
      }
      const actions: Json[] = call.actions ?? (call.action ? [call.action] : []);
      const notes: string[] = [];
      for (const a of actions) {
        r.steps++;
        const note = await runAction(page, a, guard).catch((e) => `action error: ${String(e).slice(0, 120)}`);
        if (note) {
          notes.push(note);
          break;
        }
      }
      const input: Json[] = [
        {
          type: "computer_call_output",
          call_id: call.call_id,
          output: {
            type: "computer_screenshot",
            image_url: `data:image/png;base64,${await shot(page)}`,
            detail: "original",
          },
        },
      ];
      if (notes.length) input.push({ role: "user", content: [{ type: "input_text", text: notes.join(" ") }] });
      resp = await callOpenAI({
        model: MODEL,
        tools: [{ type: "computer" }],
        truncation: "auto",
        previous_response_id: resp.id,
        input,
      });
    }
    r.blocked_submit_attempts = guard.blocked;
    if (r.outcome === "pending") {
      const s = (r.model_summary ?? "").toUpperCase();
      r.outcome = s.includes("NO_FORM")
        ? "no_form"
        : s.includes("BLOCKED")
          ? "blocked"
          : s.includes("FILLED")
            ? "filled"
            : r.steps >= maxSteps
              ? "step_limit"
              : "stopped";
    }
    r.filled_fields = await collectFilled(page);
    const file = path.join(outDir, `${lead.id}.png`);
    await page.screenshot({ path: file, fullPage: true }).catch(() => page.screenshot({ path: file }));
    r.screenshot = file;
  } catch (e) {
    r.outcome = "error";
    r.error = String(e).slice(0, 300);
  } finally {
    await ctx.close().catch(() => undefined);
  }
  return r;
}

/**
 * Mark the lead: one outreach_events row saying the form was filled (or blocked)
 * and NOT sent. Replaces any earlier contact-form row for the lead, so re-runs
 * stay idempotent. Uploads the screenshot to Storage so the lead page can link it.
 */
async function recordResult(sb: SupabaseClient, r: Result): Promise<boolean> {
  const kind = r.outcome === "filled" ? FILLED_KIND : r.outcome === "blocked" ? BLOCKED_KIND : null;
  if (!kind) return false;

  let screenshotUrl: string | null = null;
  if (r.screenshot && fs.existsSync(r.screenshot)) {
    await sb.storage.createBucket(BUCKET, { public: true }).catch(() => undefined);
    const objectPath = `contact-forms/${r.lead_id}.png`;
    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(objectPath, fs.readFileSync(r.screenshot), { contentType: "image/png", upsert: true });
    if (upErr) console.warn(`screenshot upload failed for ${r.business_name}: ${upErr.message}`);
    else screenshotUrl = `${sb.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl}?v=${Date.now()}`;
  }

  const del = await sb.from("outreach_events").delete().eq("lead_id", r.lead_id).in("kind", [FILLED_KIND, BLOCKED_KIND]);
  if (del.error) throw new Error(`clear old events failed: ${del.error.message}`);
  const ins = await sb.from("outreach_events").insert({
    lead_id: r.lead_id,
    kind,
    meta: {
      sent: false,
      dry_run: true,
      contact_url: r.contact_url,
      reason: kind === BLOCKED_KIND ? (r.model_summary ?? "").replace(/^BLOCKED:\s*/i, "") : null,
      sender_email: SENDER_EMAIL,
      fields: r.filled_fields,
      screenshot_url: screenshotUrl,
      model: MODEL,
      steps: r.steps,
    },
  });
  if (ins.error) throw new Error(`insert event failed: ${ins.error.message}`);
  return true;
}

async function recordAll(sb: SupabaseClient, results: Result[]): Promise<void> {
  let n = 0;
  for (const r of results) if (await recordResult(sb, r)) n++;
  console.log(`marked ${n} leads as contact form filled/blocked, not sent`);
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  // Record a previous run's report without re-running the browser or OpenAI.
  const importPath = arg("import-report");
  if (importPath) {
    const results = JSON.parse(fs.readFileSync(importPath, "utf8")) as Result[];
    await recordAll(sb, results);
    return;
  }

  const batchIds = (arg("batch") ?? "").split(",").filter(Boolean);
  if (!batchIds.length || !process.env.OPENAI_API_KEY) {
    console.error("need --batch=<ids> and OPENAI_API_KEY (or --import-report=<path>)");
    process.exit(2);
  }
  const outDir = arg("out") ?? path.resolve("contact-dryrun-out");
  const concurrency = Number(arg("concurrency") ?? 3);
  const maxSteps = Number(arg("max-steps") ?? 30);
  const only = arg("lead");
  fs.mkdirSync(outDir, { recursive: true });

  let q = sb.from("leads").select("id,business_name,website_url,batch_id").in("batch_id", batchIds);
  if (only) q = q.eq("id", only);
  const { data, error } = await q;
  if (error) throw error;
  const all = (data ?? []) as LeadRow[];
  // The same business often appears under several niche searches. Fill each site once.
  const seenHosts = new Set<string>();
  const leads: LeadRow[] = [];
  const skipped: Result[] = [];
  for (const l of all) {
    let host: string | null = null;
    try {
      host = l.website_url ? new URL(l.website_url).hostname.replace(/^www\./, "") : null;
    } catch {
      host = null;
    }
    if (host && seenHosts.has(host)) {
      skipped.push({
        lead_id: l.id, business_name: l.business_name, website_url: l.website_url, contact_url: null,
        outcome: "duplicate_site", steps: 0, blocked_submit_attempts: 0, aborted_requests: 0,
        filled_fields: [], model_summary: null, screenshot: null,
      });
      continue;
    }
    if (host) seenHosts.add(host);
    leads.push(l);
  }
  console.log(
    `${all.length} leads, ${all.filter((l) => l.website_url).length} with a website, ` +
      `${skipped.length} duplicate sites skipped`,
  );

  const browser = await chromium.launch({ headless: true });
  const queue = [...leads];
  const results: Result[] = [...skipped];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const lead = queue.shift()!;
        const res = await fillOne(browser, lead, outDir, maxSteps);
        results.push(res);
        console.log(
          `[${res.outcome}] ${lead.business_name} ${res.contact_url ?? ""} steps=${res.steps} ` +
            `blocked=${res.blocked_submit_attempts} aborted=${res.aborted_requests}${res.error ? " err=" + res.error.slice(0, 120) : ""}`,
        );
      }
    }),
  );
  await browser.close();
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(results, null, 2));
  console.log(`report: ${path.join(outDir, "report.json")}`);
  if (!process.argv.includes("--no-record")) await recordAll(sb, results);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
