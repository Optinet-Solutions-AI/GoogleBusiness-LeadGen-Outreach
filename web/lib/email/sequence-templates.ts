/**
 * sequence-templates.ts — Step- and segment-aware copy for the 4-step
 * progressive-trust cold-email sequence. Pure, no I/O.
 *
 * Inputs:  a lead ({ business_name, demo_url?, call_segment? }) + step (1..4)
 * Outputs: { subject, html, useScreenshot, useLink } — spintax resolved, tokens filled
 * Used by: lib/pipeline/sequence-scheduler.ts
 *
 * Approved sequence (every step 4 days apart) — Email-Outreach-Plan-for-Approval.pdf:
 *   1  Day 0   plain text, NO image, NO link
 *   2  Day 4   + inline screenshot (the SMTP sender fills the <!--SCREENSHOT--> marker)
 *   3  Day 8   + live demo link, no image
 *   4  Day 12  short break-up close, no image/link
 * Three variants: build (no_website, 4 steps), improve (old_website, 4 steps),
 * and services (has_website → AI receptionist/booking pitch, NO website/screenshot/
 * link, only 2 steps: intro + one final follow-up). Sender: "Sam from RateUp".
 * Anti-spam: NO em dashes; {spintax|variants} PLUS several distinct structural
 * variations per step (picked stably per business via pickIndex) so no two
 * recipients get identical text. The scheduler additionally runs every send
 * through spam-check and localizes it to the lead's language at send time.
 * Tokens are interpolated in JS (not {} markers) so they never collide with
 * spintax braces.
 */

import { resolveSpintax } from "../services/spintax";

export const SEQ_STEPS = [1, 2, 3, 4] as const;
export type SeqStep = (typeof SEQ_STEPS)[number];

export type SeqVariant = "build" | "improve" | "services";

/**
 * Segment → outreach variant:
 *   no_website   → build    (pitch a new website demo)
 *   old_website  → improve  (pitch a modern rebuild demo)
 *   has_website  → services (their site is fine — pitch AI services: an AI
 *                            receptionist / booking assistant. NO website.)
 */
export function variantFor(segment?: string | null): SeqVariant {
  if (segment === "old_website") return "improve";
  if (segment === "has_website") return "services";
  return "build";
}

/**
 * How many steps each variant sends before completing. The services (AI) pitch
 * stops after ONE follow-up — sending more would read as spam. build/improve
 * run the full 4-step screenshot ladder.
 */
export function maxStepForVariant(v: SeqVariant): SeqStep {
  return v === "services" ? 2 : 4;
}

export interface SeqLead {
  business_name: string;
  demo_url?: string | null;
  call_segment?: string | null;
}

export interface RenderedSequenceEmail {
  subject: string;
  html: string;
  useScreenshot: boolean;
  useLink: boolean;
}

/** Operator's per-step copy override (from call_campaigns.copy_overrides). Either
 *  field may be blank/absent — a blank field falls back to the default template. */
export interface SeqCopyOverride {
  subject?: string | null;
  body?: string | null;
}

const SIG = "Thanks,<br>Sam";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Fill {{business_name}} / {{first_name}} / {{demo_link}} in an operator-written
 *  SUBJECT (plain text). */
function fillSubjectTokens(text: string, rawName: string, first: string, demoUrl: string): string {
  return text
    .replace(/\{\{\s*business_name\s*\}\}/gi, rawName)
    .replace(/\{\{\s*first_name\s*\}\}/gi, first)
    .replace(/\{\{\s*demo_link\s*\}\}/gi, demoUrl);
}

/** Render an operator-written BODY (plain text + {{tokens}} + {spintax}) to safe
 *  HTML: escape the operator text, fill tokens (name escaped; demo_link becomes a
 *  real <a>), wrap blank-line-separated blocks in <p>, single newlines → <br>. */
function renderOverrideBody(text: string, name: string, first: string, demoUrl: string): string {
  const link = demoUrl ? `<a href="${demoUrl}">${demoUrl}</a>` : "";
  const escaped = esc(text)
    .replace(/\{\{\s*business_name\s*\}\}/gi, name)
    .replace(/\{\{\s*first_name\s*\}\}/gi, first)
    .replace(/\{\{\s*demo_link\s*\}\}/gi, link);
  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.trim().replace(/\n/g, "<br>")}</p>`)
    .filter((p) => p !== "<p></p>")
    .join("\n");
}

/**
 * Stable per-seed index into a variation list. The same business always lands
 * on the same variation (so a thread stays consistent) while different
 * businesses get different copy — so we never send one identical template to
 * everyone (a deliverability red flag). FNV-1a, kept tiny and dependency-free.
 */
function pickIndex(seed: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % n;
}

function linkBlock(demoUrl: string): string {
  return demoUrl
    ? `<p><a href="${demoUrl}">${demoUrl}</a></p>`
    : `<p>I can send the working sample over whenever you'd like.</p>`;
}

function buildCopy(
  step: SeqStep,
  rawName: string,
  name: string,
  first: string,
  demoUrl: string,
): { subject: string; html: string } {
  switch (step) {
    case 1:
      return {
        subject: `A quick idea for ${rawName}`,
        html: `<p>{Hi|Hey|Hello} ${first},</p>
<p>I'm Sam from RateUp. {I came across|I found|I spotted} ${name} on Google and noticed you don't have a website yet, so I {went ahead and built|put together} you a sample one, on spec, just to show what it could look like.</p>
<p>It's on spec with no strings attached, I just thought it came out nice.</p>
<p>{Want me to send it over?|Mind if I send it over?|Want me to send it across?}</p>
<p>${SIG}</p>`,
      };
    case 2:
      return {
        subject: `Re: A quick idea for ${rawName}`,
        html: `<p>{Hi|Hey|Hello} ${first},</p>
<p>Here's the sample site I put together for ${name} &#128071;</p>
<!--SCREENSHOT-->
<p>It's a real, working page, I can send the live link whenever you'd like to click around.</p>
<p>{Worth a look?|Open to a quick look?}</p>
<p>${SIG}</p>`,
      };
    case 3:
      return {
        subject: `Re: A quick idea for ${rawName}`,
        html: `<p>{Hi|Hey|Hello} ${first},</p>
<p>{In case it's easier to see it live, here's|Here's} the working sample for ${name}:</p>
${linkBlock(demoUrl)}
<p>Open it on your phone, it's fully mobile-friendly. Happy to tweak colors, photos or wording if you'd like it adjusted.</p>
<p>${SIG}</p>`,
      };
    case 4:
      return {
        subject: `Should I take it down?`,
        html: `<p>{Hi|Hey|Hello} ${first},</p>
<p>I'll assume the timing isn't right and take the ${name} sample offline in a few days.</p>
<p>If you'd ever like it back, just reply and I'll keep it live.</p>
<p>All the best, Sam</p>`,
      };
  }
}

function improveCopy(
  step: SeqStep,
  rawName: string,
  name: string,
  first: string,
  demoUrl: string,
): { subject: string; html: string } {
  switch (step) {
    case 1:
      return {
        subject: `A quick thought on ${rawName}'s site`,
        html: `<p>{Hi|Hey|Hello} ${first},</p>
<p>I'm Sam from RateUp. I was looking at ${name}'s website and thought it could use a refresh, so I {mocked up|put together} a modern version to show what I mean.</p>
<p>On spec, no strings attached.</p>
<p>{Want me to send it across?|Want me to send it over?|Mind if I send it across?}</p>
<p>${SIG}</p>`,
      };
    case 2:
      return {
        subject: `Re: A quick thought on ${rawName}'s site`,
        html: `<p>{Hi|Hey|Hello} ${first},</p>
<p>Here's the updated version I put together for ${name} &#128071;</p>
<!--SCREENSHOT-->
<p>Same business, just a cleaner, faster, mobile-friendly look. I can send the live link whenever you want to click through.</p>
<p>${SIG}</p>`,
      };
    case 3:
      return {
        subject: `Re: A quick thought on ${rawName}'s site`,
        html: `<p>{Hi|Hey|Hello} ${first},</p>
<p>Here's the refreshed ${name} site, live so you can try it:</p>
${linkBlock(demoUrl)}
<p>Open it on your phone and compare, happy to match your branding or drop in your own photos.</p>
<p>${SIG}</p>`,
      };
    case 4:
      return {
        subject: `Should I take it down?`,
        html: `<p>{Hi|Hey|Hello} ${first},</p>
<p>I'll take the refreshed ${name} mockup offline soon unless you'd like to keep it.</p>
<p>Just reply if you want me to leave it up.</p>
<p>Best, Sam</p>`,
      };
  }
}

/**
 * Services variant — for has_website leads. Pitches an AI assistant (receptionist
 * / booking) so they stop missing calls/bookings. NO website, NO demo screenshot
 * or link — their site is already fine.
 */
function servicesCopy(
  step: SeqStep,
  rawName: string,
  name: string,
  first: string,
): { subject: string; html: string } {
  // Two emails only: an intro that opens by saying who we are, then ONE
  // clearly-labelled follow-up that also signals it's the last one. Each step
  // has several distinct variations (picked stably per business) so we never
  // send one identical template to everyone. NO mention of their website (it's
  // not relevant — we're pitching an AI assistant), and no em dashes.
  const intros = [
    {
      subject: `An idea for ${rawName}`,
      body: `<p>{Hi|Hey|Hello} ${first},</p>
<p>I'm Sam, I run RateUp. We set local businesses up with an AI assistant, think of it as a receptionist that never clocks off. For a place like ${name} it {picks up every call|answers the phone}, handles the usual questions, and books people straight in, even after hours or when you're flat out.</p>
<p>{Curious to hear what it sounds like?|Want me to show you how it works?}</p>`,
    },
    {
      subject: `Quick question for ${rawName}`,
      body: `<p>{Hi|Hey|Hello} ${first},</p>
<p>Sam here, I'm with RateUp. Quick one: how many calls does ${name} miss on a busy day, or after you close? We build AI assistants that catch those, answer the question, and book the customer in automatically, so they don't just ring off and try someone else.</p>
<p>{Worth a quick look?|Mind if I show you?}</p>`,
    },
    {
      subject: `Helping ${rawName} catch more customers`,
      body: `<p>{Hi|Hey|Hello} ${first},</p>
<p>I'm Sam from RateUp. We help local businesses stop losing customers to missed calls and slow replies. For somewhere like ${name}, an AI assistant answers, handles the back and forth, books people in around the clock, then texts you the details.</p>
<p>{Open to seeing it?|Want a quick look?}</p>`,
    },
  ];

  const idx = pickIndex(rawName, intros.length);
  if (step === 1) {
    const chosen = intros[idx];
    return { subject: chosen.subject, html: `${chosen.body}\n<p>${SIG}</p>` };
  }

  // step 2 — the single, final follow-up. "Re:" + the same intro subject keeps
  // it threaded so it plainly reads as a follow-up.
  const followUps = [
    `<p>{Hi|Hey|Hello} ${first},</p>
<p>{Just circling back on|Following up on} my note about an AI assistant for ${name}. Short version: it answers the calls and messages you'd otherwise miss, books people in, and tells you who's coming. Happy to set up a demo you can try yourself.</p>
<p>If the timing isn't right, no worries at all, I won't email again. {Worth a quick reply?|A yes or no is plenty.}</p>`,
    `<p>{Hi|Hey|Hello} ${first},</p>
<p>Following up once on my last note. If ${name} ever loses a customer because no one could pick up, that's exactly what this fixes: an AI that answers and books any time, day or night. I can set up a demo you can try yourself.</p>
<p>Either way, this'll be the last you hear from me on it. {Mind letting me know?|Want me to send it over?}</p>`,
    `<p>{Hi|Hey|Hello} ${first},</p>
<p>Quick follow up and then I'll leave you be. The assistant I mentioned for ${name} answers, handles questions, and books people in, so nothing slips through when you're busy or closed. Want me to spin up a demo?</p>
<p>If not, all good, I won't chase it. {A quick yes or no works.|Happy either way.}</p>`,
  ];
  const fIdx = pickIndex(`${rawName}|f`, followUps.length);
  return {
    subject: `Re: ${intros[idx].subject}`,
    html: `${followUps[fIdx]}\n<p>${SIG}</p>`,
  };
}

export function renderSequenceEmail(
  lead: SeqLead,
  step: SeqStep,
  override?: SeqCopyOverride | null,
): RenderedSequenceEmail {
  const variant = variantFor(lead.call_segment);
  const rawName = lead.business_name;
  const name = esc(rawName);
  const first = esc((rawName.split(/\s+/)[0] || "there").trim());
  const demoUrl = lead.demo_url ? esc(lead.demo_url) : "";

  const def =
    variant === "improve"
      ? improveCopy(step, rawName, name, first, demoUrl)
      : variant === "services"
        ? servicesCopy(step, rawName, name, first)
        : buildCopy(step, rawName, name, first, demoUrl);

  // Operator override: use the edited subject/body where provided (tokens +
  // spintax still resolved); fall back to the default per field. useScreenshot/
  // useLink stay tied to the step/variant so step-2 still attaches the shot.
  const subjectSrc =
    override?.subject && override.subject.trim()
      ? fillSubjectTokens(override.subject, rawName, first, lead.demo_url ?? "")
      : def.subject;
  const htmlSrc =
    override?.body && override.body.trim()
      ? renderOverrideBody(override.body, name, first, demoUrl)
      : def.html;

  return {
    subject: resolveSpintax(subjectSrc),
    html: resolveSpintax(htmlSrc),
    useScreenshot: variant !== "services" && step === 2,
    useLink: variant !== "services" && step === 3,
  };
}
