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
 * Used by: operator, manually (`npx tsx scripts/contact-form-dryrun.ts --batch=...`).
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
import fs from "node:fs";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type Browser, type Page } from "playwright";

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
const VIEW = { width: 1280, height: 800 };
const CONTACT_RX =
  /contact|get[\s-]?in[\s-]?touch|reach[\s-]?us|enquir|inquir|request[\s-]?a?[\s-]?quote|get[\s-]?a?[\s-]?quote/i;
const SUBMIT_RX = /\b(send|submit|request|get (a )?quote|contact us|enviar|go)\b/i;

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

/** Find a same-site contact page link on the homepage. */
async function findContactUrl(page: Page, site: string): Promise<string | null> {
  await page.goto(site, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500);
  const links = await page.$$eval("a[href]", (as) =>
    as.map((a) => ({
      href: (a as HTMLAnchorElement).href,
      text: (a.textContent || "").trim().slice(0, 60),
    })),
  );
  const host = new URL(page.url()).hostname.replace(/^www\./, "");
  const cands = links.filter((l) => {
    try {
      const u = new URL(l.href);
      if (!/^https?:$/.test(u.protocol)) return false;
      if (u.hostname.replace(/^www\./, "") !== host) return false;
      return CONTACT_RX.test(u.pathname) || CONTACT_RX.test(l.text);
    } catch {
      return false;
    }
  });
  const isContactPath = (h: string) => Number(/contact/i.test(new URL(h).pathname));
  cands.sort((a, b) => isContactPath(b.href) - isContactPath(a.href));
  return cands[0]?.href ?? null;
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

/** Is the element under (x,y) a submit control? Checked BEFORE every click. */
async function isSubmitAt(page: Page, x: number, y: number): Promise<boolean> {
  return page.evaluate(
    ({ x, y, src }) => {
      const rx = new RegExp(src, "i");
      let el = document.elementFromPoint(x, y) as HTMLElement | null;
      for (let i = 0; el && i < 5; i++, el = el.parentElement) {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute("type") || "").toLowerCase();
        if (tag === "input" && (type === "submit" || type === "image")) return true;
        if (tag === "button") {
          const inForm = !!el.closest("form");
          if (type === "submit" || (inForm && type !== "button" && type !== "reset")) return true;
          if (rx.test(el.innerText || el.getAttribute("aria-label") || "")) return true;
        }
        if (
          (el.getAttribute("role") === "button" || tag === "a") &&
          rx.test((el.innerText || "").trim().slice(0, 40))
        )
          return true;
      }
      return false;
    },
    { x, y, src: SUBMIT_RX.source },
  );
}

async function focusedIsSingleLineInput(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return !!el && el.tagName.toLowerCase() === "input";
  });
}

const KEY_MAP: Record<string, string> = {
  ENTER: "Enter", RETURN: "Enter", TAB: "Tab", ESC: "Escape", ESCAPE: "Escape",
  BACKSPACE: "Backspace", DELETE: "Delete", SPACE: " ", CTRL: "Control", CONTROL: "Control",
  SHIFT: "Shift", ALT: "Alt", CMD: "Meta", META: "Meta", UP: "ArrowUp", DOWN: "ArrowDown",
  LEFT: "ArrowLeft", RIGHT: "ArrowRight", PAGEDOWN: "PageDown", PAGEUP: "PageUp",
};

/** Execute one model action. Returns a note if it was blocked. */
async function runAction(page: Page, a: Json, r: Result): Promise<string | null> {
  const t = a.type;
  if (t === "click" || t === "double_click") {
    if (await isSubmitAt(page, a.x, a.y)) {
      r.blocked_submit_attempts++;
      return "BLOCKED: that is the form's submit button. This is a dry run - do not submit.";
    }
    const button = a.button === "right" ? "right" : a.button === "middle" ? "middle" : "left";
    if (t === "double_click") await page.mouse.dblclick(a.x, a.y);
    else await page.mouse.click(a.x, a.y, { button });
  } else if (t === "type") {
    await page.keyboard.type(String(a.text ?? ""), { delay: 15 });
  } else if (t === "keypress") {
    const raw: string[] = a.keys ?? (a.key ? [a.key] : []);
    const keys = raw.map((k) => KEY_MAP[k.toUpperCase()] ?? k);
    if (keys.includes("Enter") && (await focusedIsSingleLineInput(page))) {
      r.blocked_submit_attempts++;
      return "BLOCKED: Enter in a single-line field would submit the form. Dry run - do not submit.";
    }
    if (keys.length > 1) await page.keyboard.press(keys.join("+"));
    else if (keys[0]) await page.keyboard.press(keys[0]);
  } else if (t === "scroll") {
    if (a.x != null && a.y != null) await page.mouse.move(a.x, a.y);
    await page.mouse.wheel(a.scroll_x ?? a.delta_x ?? 0, a.scroll_y ?? a.delta_y ?? 300);
  } else if (t === "move") {
    await page.mouse.move(a.x, a.y);
  } else if (t === "drag") {
    const p = a.path ?? [];
    if (p.length >= 2) {
      await page.mouse.move(p[0].x, p[0].y);
      await page.mouse.down();
      for (const q of p.slice(1)) await page.mouse.move(q.x, q.y);
      await page.mouse.up();
    }
  } else if (t === "wait") {
    await page.waitForTimeout(1500);
  } // "screenshot" -> nothing to do; a screenshot is always returned.
  await page.waitForTimeout(400);
  return null;
}

async function collectFilled(page: Page): Promise<Array<{ name: string; value: string }>> {
  const all = await Promise.all(
    page.frames().map((f) =>
      f
        .evaluate(() =>
          Array.from(document.querySelectorAll("input, textarea, select"))
            .map((el) => {
              const e = el as HTMLInputElement;
              if (["hidden", "submit", "button", "image"].includes(e.type)) return null;
              const label =
                e.labels?.[0]?.innerText ||
                e.getAttribute("aria-label") ||
                e.placeholder ||
                e.name ||
                e.id ||
                e.type;
              const value =
                e.type === "checkbox" || e.type === "radio" ? (e.checked ? "checked" : "") : e.value;
              return value
                ? { name: String(label).trim().slice(0, 50), value: String(value).slice(0, 300) }
                : null;
            })
            .filter(Boolean),
        )
        .catch(() => []),
    ),
  );
  return all.flat() as Array<{ name: string; value: string }>;
}

async function fillOne(browser: Browser, lead: LeadRow, outDir: string, maxSteps: number): Promise<Result> {
  const r: Result = {
    lead_id: lead.id, business_name: lead.business_name, website_url: lead.website_url,
    contact_url: null, outcome: "pending", steps: 0, blocked_submit_attempts: 0,
    aborted_requests: 0, filled_fields: [], model_summary: null, screenshot: null,
  };
  const ctx = await browser.newContext({
    viewport: VIEW,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  });
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
        const note = await runAction(page, a, r).catch((e) => `action error: ${String(e).slice(0, 120)}`);
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
