/**
 * sequence-templates.ts — Step-, segment- and STYLE-aware copy for the cold-email
 * sequence. Pure, no I/O.
 *
 * Inputs:  a lead ({ business_name, demo_url?, call_segment? }), step (1..4),
 *          optional per-step operator override, and a style.
 * Outputs: { subject, html, useScreenshot, useLink } — spintax resolved, tokens filled
 * Used by: lib/pipeline/sequence-scheduler.ts + the campaign preview/editor.
 *
 * Three segments → variant: build (no_website, 4 steps), improve (old_website,
 * 4 steps), services (has_website → AI assistant pitch, 2 steps, no demo).
 * Three STYLES per variant (operator picks one per campaign):
 *   friendly  — warm, low-pressure (our original voice)
 *   direct    — concise, value/ROI-first
 *   curiosity — opens with a question
 * Anti-spam: NO em dashes; {spintax|variants} on the greeting/close + per-business
 * token fill; the scheduler also localizes each send to the lead's language.
 */

import { resolveSpintax } from "../services/spintax";

export const SEQ_STEPS = [1, 2, 3, 4] as const;
export type SeqStep = (typeof SEQ_STEPS)[number];

export type SeqVariant = "build" | "improve" | "services";

export type SeqStyle = "friendly" | "direct" | "curiosity";

export const SEQ_STYLES: { value: SeqStyle; label: string; hint: string }[] = [
  { value: "friendly", label: "Friendly & casual", hint: "Warm, low-pressure (our original voice)" },
  { value: "direct", label: "Direct & value-first", hint: "Concise, leads with the cost of doing nothing" },
  { value: "curiosity", label: "Curiosity-led", hint: "Opens with a question that draws them in" },
];

export function asSeqStyle(s: string | null | undefined): SeqStyle {
  return s === "direct" || s === "curiosity" ? s : "friendly";
}

export function variantFor(segment?: string | null): SeqVariant {
  if (segment === "old_website") return "improve";
  if (segment === "has_website") return "services";
  return "build";
}

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

/** Operator's per-step copy override (from call_campaigns.copy_overrides). */
export interface SeqCopyOverride {
  subject?: string | null;
  body?: string | null;
}

const SIG = "Thanks,<br>Sam";
const GREET = "{Hi there|Hello|Hey there}";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fillSubjectTokens(text: string, rawName: string, first: string, demoUrl: string): string {
  return text
    .replace(/\{\{\s*business_name\s*\}\}/gi, rawName)
    .replace(/\{\{\s*first_name\s*\}\}/gi, first)
    .replace(/\{\{\s*demo_link\s*\}\}/gi, demoUrl);
}

function renderOverrideBody(text: string, name: string, first: string, demoUrl: string): string {
  const link = demoUrl ? `<a href="${demoUrl}">${demoUrl}</a>` : "";
  const escaped = esc(text)
    .replace(/\{\{\s*business_name\s*\}\}/gi, name)
    .replace(/\{\{\s*first_name\s*\}\}/gi, first)
    .replace(/\{\{\s*demo_link\s*\}\}/gi, link)
    .replace(/\{\{\s*screenshot\s*\}\}/gi, "<!--SCREENSHOT-->");
  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.trim().replace(/\n/g, "<br>")}</p>`)
    .filter((p) => p !== "<p></p>")
    .join("\n");
}

function linkBlock(demoUrl: string): string {
  return demoUrl
    ? `<p><a href="${demoUrl}">${demoUrl}</a></p>`
    : `<p>I can send the working sample over whenever you'd like.</p>`;
}

type StepCopy = { subject: string; html: string };
type CopyFn = (step: SeqStep, rawName: string, name: string, demoUrl: string) => StepCopy;

// ── BUILD (no website) ──────────────────────────────────────────────────────
const buildFriendly: CopyFn = (step, rawName, name, demoUrl) => {
  switch (step) {
    case 1: return { subject: `A quick idea for ${rawName}`, html:
`<p>${GREET},</p>
<p>I'm Sam from RateUp. {I came across|I found|I spotted} ${name} on Google and noticed you don't have a website yet, so I {went ahead and built|put together} you a sample one, on spec, just to show what it could look like.</p>
<p>It's on spec with no strings attached, I just thought it came out nice.</p>
<p>{Want me to send it over?|Mind if I send it over?}</p>
<p>${SIG}</p>` };
    case 2: return { subject: `Re: A quick idea for ${rawName}`, html:
`<p>${GREET},</p>
<p>Here's the sample site I put together for ${name} &#128071;</p>
<!--SCREENSHOT-->
<p>It's a real, working page, I can send the live link whenever you'd like to click around.</p>
<p>{Worth a look?|Open to a quick look?}</p>
<p>${SIG}</p>` };
    case 3: return { subject: `Re: A quick idea for ${rawName}`, html:
`<p>${GREET},</p>
<p>{In case it's easier to see it live, here's|Here's} the working sample for ${name}:</p>
${linkBlock(demoUrl)}
<p>Open it on your phone, it's fully mobile-friendly. Happy to tweak colors, photos or wording if you'd like it adjusted.</p>
<p>${SIG}</p>` };
    default: return { subject: `Should I take it down?`, html:
`<p>${GREET},</p>
<p>I'll assume the timing isn't right and take the ${name} sample offline in a few days.</p>
<p>If you'd ever like it back, just reply and I'll keep it live.</p>
<p>All the best, Sam</p>` };
  }
};
const buildDirect: CopyFn = (step, rawName, name, demoUrl) => {
  switch (step) {
    case 1: return { subject: `${rawName} is losing customers on Google`, html:
`<p>${GREET},</p>
<p>Sam from RateUp. When people search ${name}, there's no website to land on, so they click a competitor instead. That's lost work every week.</p>
<p>I built you a free sample site that fixes it. Want to see it?</p>
<p>${SIG}</p>` };
    case 2: return { subject: `Your ${rawName} website (sample)`, html:
`<p>${GREET},</p>
<p>Here's the site I built for ${name}:</p>
<!--SCREENSHOT-->
<p>Clear services, your contact details, click-to-call, and it loads fast on mobile, where most of your searches happen. Live link whenever you want it.</p>
<p>${SIG}</p>` };
    case 3: return { subject: `Try the ${rawName} site`, html:
`<p>${GREET},</p>
<p>The working ${name} site is live here:</p>
${linkBlock(demoUrl)}
<p>It's built to turn searchers into phone calls. Happy to put your real photos and branding on it before you decide.</p>
<p>${SIG}</p>` };
    default: return { subject: `Closing the ${rawName} sample`, html:
`<p>${GREET},</p>
<p>I'll take the ${name} sample down in a couple of days to clear it out.</p>
<p>If a steady stream of new customers from Google is worth a quick chat, just reply.</p>
<p>Best, Sam</p>` };
  }
};
const buildCuriosity: CopyFn = (step, rawName, name, demoUrl) => {
  switch (step) {
    case 1: return { subject: `a question about ${rawName}`, html:
`<p>${GREET},</p>
<p>Sam here from RateUp. Quick question: when a new customer Googles ${name}, where do they end up? Right now there's no website for them to find.</p>
<p>I mocked something up that might help. Mind if I send it?</p>
<p>${SIG}</p>` };
    case 2: return { subject: `Re: a question about ${rawName}`, html:
`<p>${GREET},</p>
<p>Here's what I meant, a sample site for ${name} &#128071;</p>
<!--SCREENSHOT-->
<p>No cost, no obligation, I just wanted to show what's possible. There's a live version too if you want to poke around.</p>
<p>Curious?</p>
<p>${SIG}</p>` };
    case 3: return { subject: `Re: a question about ${rawName}`, html:
`<p>${GREET},</p>
<p>Here's the live sample for ${name}, easier to judge on a real screen:</p>
${linkBlock(demoUrl)}
<p>Open it on your phone. If it's close, I can swap in your photos and colors in a few minutes.</p>
<p>${SIG}</p>` };
    default: return { subject: `last note on this`, html:
`<p>${GREET},</p>
<p>I'll let this go and take the ${name} sample down soon.</p>
<p>If the timing's just off, no problem, reply any time and I'll bring it back.</p>
<p>All the best, Sam</p>` };
  }
};

// ── IMPROVE (old website) ───────────────────────────────────────────────────
const improveFriendly: CopyFn = (step, rawName, name, demoUrl) => {
  switch (step) {
    case 1: return { subject: `A quick thought on ${rawName}'s site`, html:
`<p>${GREET},</p>
<p>I'm Sam from RateUp. I was looking at ${name}'s website and thought it could use a refresh, so I {mocked up|put together} a modern version to show what I mean.</p>
<p>On spec, no strings attached.</p>
<p>{Want me to send it across?|Mind if I send it across?}</p>
<p>${SIG}</p>` };
    case 2: return { subject: `Re: A quick thought on ${rawName}'s site`, html:
`<p>${GREET},</p>
<p>Here's the updated version I put together for ${name} &#128071;</p>
<!--SCREENSHOT-->
<p>Same business, just a cleaner, faster, mobile-friendly look. I can send the live link whenever you want to click through.</p>
<p>${SIG}</p>` };
    case 3: return { subject: `Re: A quick thought on ${rawName}'s site`, html:
`<p>${GREET},</p>
<p>Here's the refreshed ${name} site, live so you can try it:</p>
${linkBlock(demoUrl)}
<p>Open it on your phone and compare, happy to match your branding or drop in your own photos.</p>
<p>${SIG}</p>` };
    default: return { subject: `Should I take it down?`, html:
`<p>${GREET},</p>
<p>I'll take the refreshed ${name} mockup offline soon unless you'd like to keep it.</p>
<p>Just reply if you want me to leave it up.</p>
<p>Best, Sam</p>` };
  }
};
const improveDirect: CopyFn = (step, rawName, name, demoUrl) => {
  switch (step) {
    case 1: return { subject: `${rawName}'s site is costing you calls`, html:
`<p>${GREET},</p>
<p>Sam from RateUp. ${name}'s current site is slow and hard to use on a phone, which is exactly where your customers are. Many bounce before they call.</p>
<p>I rebuilt it, faster and modern. Want to see the difference?</p>
<p>${SIG}</p>` };
    case 2: return { subject: `${rawName}: before and after`, html:
`<p>${GREET},</p>
<p>Here's the rebuilt ${name} site:</p>
<!--SCREENSHOT-->
<p>Same content, but it loads in about a second, looks current, and makes calling you one tap. Live link on request.</p>
<p>${SIG}</p>` };
    case 3: return { subject: `Try the new ${rawName} site`, html:
`<p>${GREET},</p>
<p>The rebuilt ${name} site is live here:</p>
${linkBlock(demoUrl)}
<p>Open it next to your current one on your phone, the gap is obvious. I can match your exact branding before launch.</p>
<p>${SIG}</p>` };
    default: return { subject: `Closing the ${rawName} rebuild`, html:
`<p>${GREET},</p>
<p>I'll take the ${name} rebuild down in a couple of days.</p>
<p>If a faster site that turns visitors into calls is worth ten minutes, just reply.</p>
<p>Best, Sam</p>` };
  }
};
const improveCuriosity: CopyFn = (step, rawName, name, demoUrl) => {
  switch (step) {
    case 1: return { subject: `noticed something about ${rawName}'s site`, html:
`<p>${GREET},</p>
<p>Sam here from RateUp. I was on ${name}'s website and one thing stood out that's probably costing you customers. It's easier to show than explain.</p>
<p>I built a modern version to make the point. Mind if I send it?</p>
<p>${SIG}</p>` };
    case 2: return { subject: `Re: noticed something about ${rawName}'s site`, html:
`<p>${GREET},</p>
<p>Here's the modern version of ${name} I mentioned &#128071;</p>
<!--SCREENSHOT-->
<p>Notice how much faster and clearer it feels. There's a live one too if you want to try it.</p>
<p>Worth comparing?</p>
<p>${SIG}</p>` };
    case 3: return { subject: `Re: noticed something about ${rawName}'s site`, html:
`<p>${GREET},</p>
<p>Here's the refreshed ${name} site, live:</p>
${linkBlock(demoUrl)}
<p>Pull it up next to your current site on your phone. If you like the direction, I'll match your branding and photos.</p>
<p>${SIG}</p>` };
    default: return { subject: `last note on the ${rawName} site`, html:
`<p>${GREET},</p>
<p>I'll let this rest and take the ${name} mockup down soon.</p>
<p>If you'd like another look later, just reply and I'll put it back up.</p>
<p>All the best, Sam</p>` };
  }
};

// ── SERVICES (has website → AI assistant; 2 steps, no demo) ──────────────────
const servicesFriendly: CopyFn = (step, rawName, name) => {
  if (step === 1) return { subject: `An idea for ${rawName}`, html:
`<p>${GREET},</p>
<p>I'm Sam, I run RateUp. We set local businesses up with an AI assistant, think of it as a receptionist that never clocks off. For a place like ${name} it {picks up every call|answers the phone}, handles the usual questions, and books people straight in, even after hours or when you're flat out.</p>
<p>{Curious to hear what it sounds like?|Want me to show you how it works?}</p>
<p>${SIG}</p>` };
  return { subject: `Re: An idea for ${rawName}`, html:
`<p>${GREET},</p>
<p>{Just circling back on|Following up on} my note about an AI assistant for ${name}. Short version: it answers the calls and messages you'd otherwise miss, books people in, and tells you who's coming. Happy to set up a demo you can try yourself.</p>
<p>If the timing isn't right, no worries at all, I won't email again. {Worth a quick reply?|A yes or no is plenty.}</p>
<p>${SIG}</p>` };
};
const servicesDirect: CopyFn = (step, rawName, name) => {
  if (step === 1) return { subject: `How many calls does ${rawName} miss?`, html:
`<p>${GREET},</p>
<p>Sam from RateUp. Every missed call at ${name} is a customer who just dials the next business. Our AI assistant answers every one, handles the usual questions, and books them in automatically, around the clock.</p>
<p>Most owners are surprised how many calls they were losing. Want to see it work?</p>
<p>${SIG}</p>` };
  return { subject: `Re: How many calls does ${rawName} miss?`, html:
`<p>${GREET},</p>
<p>Following up once. The AI assistant for ${name} pays for itself the first time it catches a job you'd have missed after hours. It answers, books, and texts you the details. I can set up a demo on your own number.</p>
<p>This is the last you'll hear from me on it. Worth a look?</p>
<p>${SIG}</p>` };
};
const servicesCuriosity: CopyFn = (step, rawName, name) => {
  if (step === 1) return { subject: `catching more customers for ${rawName}`, html:
`<p>${GREET},</p>
<p>I'm Sam from RateUp. Quick one: what happens to a ${name} customer who calls while you're busy or closed? Usually they're gone. We fix that with an AI assistant that answers, handles the back and forth, books people in around the clock, then texts you the details.</p>
<p>Open to seeing it?</p>
<p>${SIG}</p>` };
  return { subject: `Re: catching more customers for ${rawName}`, html:
`<p>${GREET},</p>
<p>Quick follow up and then I'll leave you be. The assistant I mentioned for ${name} answers, handles questions, and books people in, so nothing slips through when you're busy or closed. Want me to spin up a demo?</p>
<p>If not, all good, I won't chase it. A quick yes or no works.</p>
<p>${SIG}</p>` };
};

const COPY: Record<SeqVariant, Record<SeqStyle, CopyFn>> = {
  build: { friendly: buildFriendly, direct: buildDirect, curiosity: buildCuriosity },
  improve: { friendly: improveFriendly, direct: improveDirect, curiosity: improveCuriosity },
  services: { friendly: servicesFriendly, direct: servicesDirect, curiosity: servicesCuriosity },
};

/** HTML default template → editable plain text (tokens + spintax preserved). */
function htmlToEditable(html: string): string {
  return html
    .replace(/<!--SCREENSHOT-->/g, "{{screenshot}}")
    .replace(/<p>\s*<a [^>]*>[^<]*<\/a>\s*<\/p>/g, "{{demo_link}}")
    .replace(/<p>I can send the working sample over whenever you'd like\.<\/p>/g, "{{demo_link}}")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/g, "\n\n")
    .replace(/<\/?p>/g, "")
    .replace(/&#128071;/g, "\u{1F447}")
    .trim();
}

/** The default editable copy (plain text + tokens + spintax) for a step+style,
 *  or null if that step doesn't exist for the variant. Pre-fills the copy editor. */
export function defaultEditableCopy(
  variant: SeqVariant,
  step: SeqStep,
  style: SeqStyle = "friendly",
): { subject: string; body: string } | null {
  if (step > maxStepForVariant(variant)) return null;
  const def = COPY[variant][style](step, "{{business_name}}", "{{business_name}}", "{{demo_link}}");
  return { subject: def.subject, body: htmlToEditable(def.html) };
}

export function renderSequenceEmail(
  lead: SeqLead,
  step: SeqStep,
  override?: SeqCopyOverride | null,
  style: SeqStyle = "friendly",
): RenderedSequenceEmail {
  const variant = variantFor(lead.call_segment);
  const rawName = lead.business_name;
  const name = esc(rawName);
  const first = esc((rawName.split(/\s+/)[0] || "there").trim());
  const demoUrl = lead.demo_url ? esc(lead.demo_url) : "";

  const def = COPY[variant][style](step, rawName, name, demoUrl);

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
