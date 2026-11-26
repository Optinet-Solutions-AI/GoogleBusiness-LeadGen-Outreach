/**
 * services/contact-form-browser.ts — open a lead's contact page in Chromium; screenshot it (free), or let OpenAI
 * computer-use fill it with our message and click Send exactly once (paid).
 *
 * Inputs:  their website / contact page + host, our sender name / email, subject, message, the computer-use model;
 *          OPENAI_API_KEY
 * Outputs: lookForm → {status ready|no_form|blocked, contactUrl, shot PNG, reason};
 *          fillAndSubmit → {outcome sent|failed|unknown|blocked|no_form, reason, fields, filledShot, resultShot, usage}.
 *          Also exports the browser helpers shared with scripts/contact-form-dryrun.ts.
 * Used by: lib/contact-form/runs.ts (Cloud Run MODE=contact-form), scripts/contact-form-dryrun.ts (dry run)
 *
 * Needs Chromium → Cloud Run job only. Safety, enforced in code (not just asked of the AI):
 *  - while filling, nothing but GET/HEAD/OPTIONS leaves the browser and submit clicks / Enter are blocked;
 *  - no click on a link to another site; a page that leaves their site stops the run;
 *  - when sending, exactly ONE click (or Enter) is allowed, typing is blocked, then we only look.
 * A CAPTCHA is never solved: the AI is told to stop, and a page that only shows a challenge is "blocked".
 */
import "@/lib/server-guard";
import { chromium, type Browser, type Page } from "playwright";
import { env } from "@/lib/config";
import { getLogger } from "@/lib/logger";
import { retry } from "@/lib/retry";
import { sameSite } from "@/lib/contact-form/rules";
import { failOpenAi, recordOpenAiResult, shouldRetryOpenAi } from "./openai-health";

const log = getLogger("contact-form");
const URL_RESPONSES = "https://api.openai.com/v1/responses";
export const VIEW = { width: 1280, height: 800 };
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
export const CONTACT_RX =
  /contact|get[\s-]?in[\s-]?touch|reach[\s-]?us|enquir|inquir|request[\s-]?a?[\s-]?quote|get[\s-]?a?[\s-]?quote/i;
export const SUBMIT_RX = /\b(send|submit|request|get (a )?quote|contact us|enviar|go)\b/i;
const CAPTCHA_FRAME_RX = /recaptcha|hcaptcha|turnstile|challenges\.cloudflare\.com/i;
// "Please confirm you're human" + "I'm not a robot" = the popup Wix forms show after Send (25 Nov 2026).
const CHALLENGE_TEXT_RX = /verify you are human|confirm you(?:'|’)?re human|confirm that you are human|i(?:'|’)?m not a robot|checking your browser|just a moment\.\.\.|are you a robot/i;

/** Does this page text show a bot check? Pure (also used after Send). */
export function isChallengeText(text: string): boolean {
  return CHALLENGE_TEXT_RX.test(text);
}

/** A page's own "your message was sent" wording (Wix, WordPress, Squarespace, our test form…). */
const SUCCESS_TEXT_RX =
  /thank you|thanks for (?:submitting|contacting|reaching|getting in touch|your (?:message|enquiry|inquiry|submission|interest))|(?:message|form|enquiry|inquiry|submission|request)\b.{0,25}\b(?:sent|received|submitted|delivered)|(?:sent|submitted|received) successfully|successfully (?:sent|submitted|received)|we(?:'|’)?ll (?:be in touch|get back to you)|we will (?:be in touch|get back to you)|received your (?:message|enquiry|inquiry|request)/i;
const SUCCESS_URL_RX = /thank|success|sent|confirm/i;

/** Does this page text confirm the message went out? Pure. The final verdict stays with the AI's read of the screenshot. */
export function isSuccessText(text: string): boolean {
  return SUCCESS_TEXT_RX.test(text);
}

/**
 * After the one Send click: wait until their page confirms (its thank-you message, or a move to a thank-you page), so
 * the "after" screenshot shows the success and not a half-loaded page (operator, 26 Nov 2026). Stops at once on a bot
 * check; gives up after maxMs. Thank-you words already on the page before Send don't count. Never clicks anything.
 */
export async function waitForConfirmation(o: {
  read: () => Promise<{ text: string; url: string }>;
  before: { text: string; url: string };
  sleep: (ms: number) => Promise<unknown>;
  maxMs: number;
  stepMs: number;
}): Promise<"confirmed" | "challenge" | "timeout"> {
  const hadSuccessWords = isSuccessText(o.before.text);
  for (let waited = 0; ; waited += o.stepMs) {
    const now = await o.read();
    if (isChallengeText(now.text)) return "challenge";
    if (!hadSuccessWords && isSuccessText(now.text)) return "confirmed";
    if (now.url !== o.before.url && SUCCESS_URL_RX.test(now.url)) return "confirmed";
    if (waited >= o.maxMs) return "timeout";
    await o.sleep(o.stepMs);
  }
}

/** What the operator reads when a CAPTCHA stopped the send after Send was clicked. */
const AFTER_SEND_CAPTCHA =
  "After Send, their site asked to prove you're human (a CAPTCHA), so it didn't go through. Send it yourself: copy the message, open their page, paste, tick the box and send, then press \"I sent it myself\".";

/* ------------------------------------------------------------------ pure helpers ------------------------------- */

export type Usage = { input_tokens: number; output_tokens: number };

/** The AI's last non-empty line (it may think out loud above it). */
const lastLine = (text: string) => text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? "";

/**
 * The AI's last line after filling: exactly FILLED / NO_FORM / BLOCKED:<reason>. FILLED must be the whole line, in
 * capitals ("I filled what I could, but…" is not FILLED). Anything else = blocked: never send on a guess.
 */
export function parseFillReply(text: string): { kind: "filled" | "no_form" | "blocked"; reason: string | null } {
  const line = lastLine(text);
  if (/^FILLED\.?$/.test(line)) return { kind: "filled", reason: null };
  if (/^NO_FORM\.?$/.test(line)) return { kind: "no_form", reason: null };
  const b = /^BLOCKED\s*:?\s*(.*)$/i.exec(line);
  if (b) return { kind: "blocked", reason: b[1].trim() || null };
  return { kind: "blocked", reason: "The AI couldn't confirm the form was filled." };
}

/** The AI's verdict on the page after Send: SENT / ERROR:<text> / CAPTCHA on the last line; anything else = unknown. */
export function parseResultReply(text: string): { outcome: "sent" | "failed" | "unknown" | "blocked"; reason: string | null } {
  const line = lastLine(text);
  if (/^SENT\.?$/.test(line)) return { outcome: "sent", reason: null };
  if (/^CAPTCHA\.?$/i.test(line)) return { outcome: "blocked", reason: AFTER_SEND_CAPTCHA };
  const e = /^ERROR\s*:\s*(.*)$/.exec(line);
  if (e) return { outcome: "failed", reason: e[1].trim() || null };
  return { outcome: "unknown", reason: null };
}

/** Cost of the OpenAI calls, from their reported usage. */
export function formUsd(usage: Usage, prices: { inPerMTok: number; outPerMTok: number }): number {
  const usd = (usage.input_tokens * prices.inPerMTok + usage.output_tokens * prices.outPerMTok) / 1_000_000;
  return Math.round(usd * 10_000) / 10_000;
}

/* ------------------------------------------------------------------ browser helpers (shared with the dry run) -- */

/** Find a same-site contact page link on the homepage (the page is left on the homepage). */
export async function findContactUrl(page: Page, site: string): Promise<string | null> {
  await page.goto(site, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500);
  const links = await page.$$eval("a[href]", (as) =>
    as.map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a.textContent || "").trim().slice(0, 60) })),
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

/** Is the element under (x,y) a submit control? Checked BEFORE every click. */
export async function isSubmitAt(page: Page, x: number, y: number): Promise<boolean> {
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
        if ((el.getAttribute("role") === "button" || tag === "a") && rx.test((el.innerText || "").trim().slice(0, 40)))
          return true;
      }
      return false;
    },
    { x, y, src: SUBMIT_RX.source },
  );
}

/** The link under (x,y), if any (to stop clicks that would leave their site). */
async function linkAt(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const a = el?.closest("a[href]") as HTMLAnchorElement | null;
    return a?.href ?? null;
  }, { x, y });
}

export type FocusKind = "textarea" | "editable" | "input" | "button" | "other";

/** What has keyboard focus (in the page or one frame deep): Enter / Space / a typed newline mean different things. */
export async function focusedKind(page: Page): Promise<FocusKind> {
  return page.evaluate(() => {
    let el = document.activeElement as HTMLElement | null;
    for (let i = 0; el && el.tagName === "IFRAME" && i < 3; i++) {
      try {
        el = ((el as HTMLIFrameElement).contentDocument?.activeElement as HTMLElement | null) ?? null;
      } catch {
        break; // cross-origin frame: can't see inside → treated as "other"
      }
    }
    if (!el) return "other";
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "textarea") return "textarea";
    if (el.isContentEditable) return "editable";
    if (tag === "button" || el.getAttribute("role") === "button" || tag === "a") return "button";
    if (tag === "input") return ["submit", "button", "image", "reset"].includes(type) ? "button" : "input";
    return "other";
  }) as Promise<FocusKind>;
}

export const KEY_MAP: Record<string, string> = {
  ENTER: "Enter", RETURN: "Enter", TAB: "Tab", ESC: "Escape", ESCAPE: "Escape",
  BACKSPACE: "Backspace", DELETE: "Delete", SPACE: " ", CTRL: "Control", CONTROL: "Control",
  SHIFT: "Shift", ALT: "Alt", CMD: "Meta", META: "Meta", UP: "ArrowUp", DOWN: "ArrowDown",
  LEFT: "ArrowLeft", RIGHT: "ArrowRight", PAGEDOWN: "PageDown", PAGEUP: "PageUp",
};

/**
 * What the browser may do. "fill": no submit (clicks on Send / Enter in an input are blocked).
 * "submit": exactly one click or Enter, no typing. `host` set → clicks on links to other sites are blocked.
 */
export interface ActionGuard {
  phase: "fill" | "submit";
  host: string | null;
  submits: number;
  blocked: number;
  /** Told to the AI when it tries to send while filling. */
  fillNote: string;
}

/** OpenAI computer-use payloads are loosely documented, so they're handled untyped. */
type Json = any;

/** Run one model action under the guard. Returns a note for the AI when the action was refused. */
export async function runAction(page: Page, a: Json, g: ActionGuard): Promise<string | null> {
  const t = a.type;
  if (t === "click" || t === "double_click") {
    if (g.phase === "fill") {
      if (await isSubmitAt(page, a.x, a.y)) {
        g.blocked++;
        return g.fillNote;
      }
      const href = g.host ? await linkAt(page, a.x, a.y) : null;
      if (href && /^https?:/i.test(href) && !sameSite(href, g.host!)) {
        g.blocked++;
        return "BLOCKED: that link leaves their website. Stay on this page.";
      }
    } else {
      if (g.submits >= 1) {
        g.blocked++;
        return "BLOCKED: the send button was already clicked once. Stop now.";
      }
      g.submits++;
      // While sending a double-click would press Send twice: always one plain click.
      await page.mouse.click(a.x, a.y);
      await page.waitForTimeout(400);
      return null;
    }
    const button = a.button === "right" ? "right" : a.button === "middle" ? "middle" : "left";
    if (t === "double_click") await page.mouse.dblclick(a.x, a.y);
    else await page.mouse.click(a.x, a.y, { button });
  } else if (t === "type") {
    if (g.phase === "submit") {
      g.blocked++;
      return "BLOCKED: don't change the fields now. Only click the send button once.";
    }
    let text = String(a.text ?? "");
    // A newline typed into a one-line input is an Enter: it would submit the form.
    if (/[\r\n]/.test(text) && (await focusedKind(page)) !== "textarea" && (await focusedKind(page)) !== "editable") {
      text = text.replace(/[\r\n]+/g, " ").trim();
    }
    await page.keyboard.type(text, { delay: 15 });
  } else if (t === "keypress") {
    const raw: string[] = a.keys ?? (a.key ? [a.key] : []);
    const keys = raw.map((k) => KEY_MAP[k.toUpperCase()] ?? k);
    if (g.phase === "fill" && (keys.includes("Enter") || keys.includes(" "))) {
      const focus = await focusedKind(page);
      // Enter only inside a multi-line box; Space never on a button (both would press Send).
      if ((keys.includes("Enter") && focus !== "textarea" && focus !== "editable") || (keys.includes(" ") && focus === "button")) {
        g.blocked++;
        return g.fillNote;
      }
    }
    if (keys.includes("Enter")) {
      if (g.phase === "submit") {
        if (g.submits >= 1) {
          g.blocked++;
          return "BLOCKED: the form was already sent once. Stop now.";
        }
        g.submits++;
      }
    } else if (g.phase === "submit") {
      g.blocked++;
      return "BLOCKED: don't change the fields now. Only click the send button once.";
    }
    if (keys.length > 1) await page.keyboard.press(keys.join("+"));
    else if (keys[0]) await page.keyboard.press(keys[0]);
  } else if (t === "scroll") {
    if (a.x != null && a.y != null) await page.mouse.move(a.x, a.y);
    await page.mouse.wheel(a.scroll_x ?? a.delta_x ?? 0, a.scroll_y ?? a.delta_y ?? 300);
  } else if (t === "move") {
    await page.mouse.move(a.x, a.y);
  } else if (t === "drag") {
    if (g.phase === "submit") {
      g.blocked++;
      return "BLOCKED: only click the send button once.";
    }
    const p = a.path ?? [];
    if (p.length >= 2) {
      await page.mouse.move(p[0].x, p[0].y);
      await page.mouse.down();
      for (const q of p.slice(1)) await page.mouse.move(q.x, q.y);
      await page.mouse.up();
    }
  } else if (t === "wait") {
    await page.waitForTimeout(1500);
  } // "screenshot" → nothing to do; a screenshot is always returned.
  await page.waitForTimeout(400);
  return null;
}

/** The fields that hold a value right now, in every frame (label → value). */
export async function collectFilled(page: Page): Promise<Array<{ name: string; value: string }>> {
  const all = await Promise.all(
    page.frames().map((f) =>
      f
        .evaluate(() =>
          Array.from(document.querySelectorAll("input, textarea, select"))
            .map((el) => {
              const e = el as HTMLInputElement;
              if (["hidden", "submit", "button", "image"].includes(e.type)) return null;
              const label = e.labels?.[0]?.innerText || e.getAttribute("aria-label") || e.placeholder || e.name || e.id || e.type;
              const value = e.type === "checkbox" || e.type === "radio" ? (e.checked ? "checked" : "") : e.value;
              return value ? { name: String(label).trim().slice(0, 50), value: String(value).slice(0, 300) } : null;
            })
            .filter(Boolean),
        )
        .catch(() => []),
    ),
  );
  return all.flat() as Array<{ name: string; value: string }>;
}

/* ------------------------------------------------------------------ OpenAI ------------------------------------ */

async function callOpenAI(body: unknown): Promise<Json> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  const res = await retry(
    async () => {
      const r = await fetch(URL_RESPONSES, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify(body),
      });
      if (await shouldRetryOpenAi(r)) throw new Error(`openai ${r.status}`);
      return r;
    },
    { maxAttempts: 3 },
  );
  if (!res.ok) await failOpenAi(res, "contact-form");
  return res.json();
}

const shot = async (page: Page): Promise<Buffer> => page.screenshot({ type: "png" });
const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;
const messageText = (resp: Json): string =>
  (resp.output ?? [])
    .filter((o: Json) => o.type === "message")
    .flatMap((m: Json) => m.content ?? [])
    .map((c: Json) => c.text)
    .filter(Boolean)
    .join(" ");

async function withPage<T>(fn: (page: Page, ctx: Awaited<ReturnType<Browser["newContext"]>>) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try {
    // Service workers can answer requests the route guard never sees: off.
    const ctx = await browser.newContext({ viewport: VIEW, userAgent: BROWSER_UA, serviceWorkers: "block" });
    const page = await ctx.newPage();
    return await fn(page, ctx);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ look (free) ------------------------------- */

export interface LookResult {
  status: "ready" | "no_form" | "blocked";
  contactUrl: string | null;
  shot: Buffer | null;
  reason: string | null;
}

/** Open their contact page (saved one on their site, else found on the homepage) and screenshot it. No AI. */
export async function lookForm(input: { siteUrl: string | null; contactUrl: string | null; host: string }): Promise<LookResult> {
  return withPage(async (page) => {
    let contactUrl = input.contactUrl;
    try {
      if (!contactUrl && input.siteUrl) {
        contactUrl = await findContactUrl(page, input.siteUrl);
        if (!contactUrl && (await hasForm(page))) contactUrl = page.url(); // the form is on the homepage
      }
    } catch (e) {
      log.warn({ err: String(e).slice(0, 200) }, "contact_form.look_site_failed");
      return { status: "no_form", contactUrl: null, shot: null, reason: "We couldn't open their website." };
    }
    if (!contactUrl || !sameSite(contactUrl, input.host)) {
      return { status: "no_form", contactUrl: null, shot: null, reason: "No contact page found on their website." };
    }
    try {
      await page.goto(contactUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2500);
    } catch {
      return { status: "no_form", contactUrl, shot: null, reason: "Their contact page didn't open." };
    }
    const png = await shot(page);
    if (await hasForm(page)) return { status: "ready", contactUrl, shot: png, reason: null };
    if (await hasChallenge(page)) {
      return { status: "blocked", contactUrl, shot: png, reason: "The page shows a CAPTCHA / bot check." };
    }
    return { status: "no_form", contactUrl, shot: png, reason: "There's no form on their contact page." };
  });
}

async function hasForm(page: Page): Promise<boolean> {
  for (const f of page.frames()) {
    const found = await f
      .evaluate(() =>
        Array.from(document.querySelectorAll("textarea, input[type=email]")).some((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }),
      )
      .catch(() => false);
    if (found) return true;
  }
  return false;
}

/** The page's visible text and address, for the wait after Send. Never throws (a navigating page reads as empty). */
async function readPage(page: Page): Promise<{ text: string; url: string }> {
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 30000) ?? "").catch(() => "");
  return { text, url: page.url() };
}

/** Bring their thank-you message into view, so the screenshot shows it. Best effort. */
async function showConfirmation(page: Page): Promise<void> {
  await page.getByText(SUCCESS_TEXT_RX).first().scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

async function hasChallenge(page: Page): Promise<boolean> {
  if (page.frames().some((f) => CAPTCHA_FRAME_RX.test(f.url()))) return true;
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) ?? "").catch(() => "");
  return CHALLENGE_TEXT_RX.test(text);
}

/* ------------------------------------------------------------------ fill + send (paid) ------------------------ */

export interface SendInput {
  contactUrl: string;
  host: string;
  businessName: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  message: string;
  model: string;
  maxSteps?: number;
  /** Epoch ms: past this, the send step never starts (the dashboard will already show "check their page"). */
  deadline?: number;
}

export interface SendResult {
  outcome: "sent" | "failed" | "unknown" | "blocked" | "no_form";
  reason: string | null;
  fields: { name: string; value: string }[];
  filledShot: Buffer | null;
  resultShot: Buffer | null;
  usage: Usage;
}

const FILL_NOTE = "BLOCKED: don't send yet. Fill the fields first, then stop and reply FILLED.";

function fillTask(i: SendInput): string {
  return (
    `You are on the contact page of "${i.businessName}". Fill in its contact form to send them a message. ` +
    `DO NOT click the send/submit button yet and DO NOT press Enter in single-line fields: you will be told when to send.\n` +
    `Use exactly: name "${i.senderName}", email "${i.senderEmail}"` +
    (i.subject ? `, subject "${i.subject}"` : "") +
    `. Message:\n"${i.message}"\n` +
    `Leave phone and every field you have no true value for EMPTY — never invent data. ` +
    `If a REQUIRED field asks for something we don't have (phone, address, order number…), stop and reply BLOCKED:<that field>. ` +
    `If a dropdown asks for a reason/topic, pick the closest general, sales or partnership option. ` +
    `If there is a CAPTCHA or "I'm not a robot" check, do not try to solve it: reply BLOCKED:captcha. ` +
    `Close cookie banners or popups if they cover the form. Don't follow links to other websites. ` +
    `If there is no contact form on this page, reply NO_FORM. ` +
    `When every field you can fill is filled, stop. Your LAST line must be exactly one of: FILLED, NO_FORM, or BLOCKED:<reason>.`
  );
}

/** One OpenAI computer-use loop: run its actions under the guard until it replies with text or `maxSteps`. */
async function drive(
  page: Page,
  g: ActionGuard,
  first: Json,
  model: string,
  maxSteps: number,
  addUsage: (r: Json) => void,
  stopWhen: () => boolean = () => false,
): Promise<{ resp: Json; text: string; safetyStop: boolean; steps: number }> {
  let resp = first;
  let steps = 0;
  for (;;) {
    const out: Json[] = resp.output ?? [];
    const call = out.find((o) => o.type === "computer_call");
    const text = messageText(resp);
    if (!call || steps >= maxSteps || stopWhen()) return { resp, text, safetyStop: false, steps };
    if (call.pending_safety_checks?.length) return { resp, text, safetyStop: true, steps };
    const actions: Json[] = call.actions ?? (call.action ? [call.action] : []);
    const notes: string[] = [];
    for (const a of actions) {
      steps++;
      const note = await runAction(page, a, g).catch((e) => `action error: ${String(e).slice(0, 120)}`);
      if (note) {
        notes.push(note);
        break;
      }
      if (stopWhen()) break;
    }
    if (stopWhen()) return { resp, text, safetyStop: false, steps };
    const input: Json[] = [
      { type: "computer_call_output", call_id: call.call_id, output: { type: "computer_screenshot", image_url: dataUrl(await shot(page)), detail: "original" } },
    ];
    if (notes.length) input.push({ role: "user", content: [{ type: "input_text", text: notes.join(" ") }] });
    resp = await callOpenAI({ model, tools: [{ type: "computer" }], truncation: "auto", previous_response_id: resp.id, input });
    addUsage(resp);
  }
}

/** Fill their form with our message, then click Send exactly once and read their page. Never throws. */
export async function fillAndSubmit(i: SendInput): Promise<SendResult> {
  const usage: Usage = { input_tokens: 0, output_tokens: 0 };
  const addUsage = (r: Json) => {
    usage.input_tokens += Number(r?.usage?.input_tokens ?? 0);
    usage.output_tokens += Number(r?.usage?.output_tokens ?? 0);
  };
  const g: ActionGuard = { phase: "fill", host: i.host, submits: 0, blocked: 0, fillNote: FILL_NOTE };
  let fields: { name: string; value: string }[] = [];
  let filledShot: Buffer | null = null;
  const done = (o: SendResult["outcome"], reason: string | null, resultShot: Buffer | null = null): SendResult => ({
    outcome: o, reason, fields, filledShot, resultShot, usage,
  });

  try {
    return await withPage(async (page, ctx) => {
      // HARD GUARD while filling: nothing but GET/HEAD/OPTIONS leaves the browser.
      await ctx.route("**/*", (route) => {
        const m = route.request().method();
        if (g.phase === "submit" || m === "GET" || m === "HEAD" || m === "OPTIONS") return route.continue();
        return route.abort();
      });
      await page.goto(i.contactUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2500);

      const first = await callOpenAI({
        model: i.model,
        tools: [{ type: "computer" }],
        truncation: "auto",
        input: [
          { role: "user", content: [{ type: "input_text", text: fillTask(i) }, { type: "input_image", image_url: dataUrl(await shot(page)), detail: "original" }] },
        ],
      });
      addUsage(first);
      const fill = await drive(page, g, first, i.model, i.maxSteps ?? 30, addUsage);
      fields = await collectFilled(page);
      filledShot = await shot(page);
      if (fill.safetyStop) return done("blocked", "The AI stopped for a safety check. Nothing was sent.");
      if (!sameSite(page.url(), i.host)) return done("blocked", "The page left their website while filling. Nothing was sent.");
      const verdict = parseFillReply(fill.text);
      if (verdict.kind === "no_form") return done("no_form", "The AI found no contact form on the page.");
      if (verdict.kind === "blocked") return done("blocked", verdict.reason);

      if (i.deadline && Date.now() > i.deadline) {
        return done("blocked", "It took too long to get ready, so it didn't press Send. Nothing was sent.");
      }
      // SEND: exactly one click / Enter from here on, no typing.
      g.phase = "submit";
      const ask = await callOpenAI({
        model: i.model,
        tools: [{ type: "computer" }],
        truncation: "auto",
        previous_response_id: fill.resp.id,
        input: [{ role: "user", content: [{ type: "input_text", text: "Good. Now click the form's send/submit button ONCE. Do nothing else." }] }],
      });
      addUsage(ask);
      // What the page said before the click: thank-you words already there can't confirm anything.
      const before = await readPage(page);
      await drive(page, g, ask, i.model, 6, addUsage, () => g.submits >= 1);
      if (g.submits === 0) return done("blocked", "The AI didn't find the send button. Nothing was sent.");

      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
      // Wait for their page to confirm (up to 20 s more), then screenshot with the thank-you message in view.
      const settled = await waitForConfirmation({
        read: () => readPage(page),
        before,
        sleep: (ms) => page.waitForTimeout(ms),
        maxMs: 20_000,
        stepMs: 1000,
      });
      if (settled === "confirmed") await showConfirmation(page);
      else await page.waitForTimeout(1500);
      let resultShot = await shot(page);
      // A bot check that pops up after Send (Wix: "Please confirm you're human"): it didn't go out. Free check first.
      if (await hasChallenge(page)) return done("blocked", AFTER_SEND_CAPTCHA, resultShot);
      const askVerdict = (png: Buffer) =>
        callOpenAI({
        model: i.model,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "This is a website contact page right after its send button was clicked. Reply with ONE line: " +
                  "SENT if the page clearly confirms the message was sent (a thank-you / success message), " +
                  "ERROR:<the error text shown> if the form shows an error, CAPTCHA if a human check / \"I'm not a robot\" box " +
                  "is showing, or UNCLEAR if you are not sure. Nothing else.",
              },
              { type: "input_image", image_url: dataUrl(png), detail: "original" },
            ],
          },
        ],
      });
      const check = await askVerdict(resultShot);
      addUsage(check);
      await recordOpenAiResult("ok", "contact-form");
      let r = parseResultReply(messageText(check));
      // Not sure and nothing confirmed yet: a slow site may still be sending. Wait once more and look again (no click).
      if (r.outcome === "unknown" && settled !== "confirmed") {
        await page.waitForTimeout(6000);
        const late = await readPage(page);
        if (isSuccessText(late.text) && !isSuccessText(before.text)) await showConfirmation(page);
        resultShot = await shot(page);
        if (await hasChallenge(page)) return done("blocked", AFTER_SEND_CAPTCHA, resultShot);
        const again = await askVerdict(resultShot);
        addUsage(again);
        r = parseResultReply(messageText(again));
      }
      const reason =
        r.outcome === "failed"
          ? `Their page showed an error${r.reason ? `: "${r.reason}"` : ""}, so it probably didn't go through. Check their page before trying again.`
          : r.reason;
      return done(r.outcome, reason, resultShot);
    });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 200);
    log.warn({ err: msg, submitted: g.submits > 0 }, "contact_form.send_error");
    // After the one click the message may have gone out: never call that "failed" (a retry could send it twice).
    if (g.submits > 0) return done("unknown", "Something went wrong right after clicking send.");
    const why = /OPENAI_API_KEY missing|key_invalid|no_credit/.test(msg)
      ? "AI is unavailable (no key or no credit)."
      : /net::|Timeout|timeout/.test(msg)
        ? "Their contact page didn't open."
        : "Something went wrong before sending.";
    return done("failed", `${why} Nothing was sent.`);
  }
}
