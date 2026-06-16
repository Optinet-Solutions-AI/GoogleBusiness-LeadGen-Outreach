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
 * Two variants: build (no_website) and improve (old_website). Sender: "Sam from
 * RateUp". {spintax|variants} are resolved per send so no two recipients get
 * identical text (a spam signal). Tokens are interpolated in JS (not {} markers)
 * so they never collide with spintax braces.
 */

import { resolveSpintax } from "../services/spintax";

export const SEQ_STEPS = [1, 2, 3, 4] as const;
export type SeqStep = (typeof SEQ_STEPS)[number];

export type SeqVariant = "build" | "improve";

/** old_website → improve; everything else (no_website, null) → build. */
export function variantFor(segment?: string | null): SeqVariant {
  return segment === "old_website" ? "improve" : "build";
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

const SIG = "&mdash; Sam";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
<p>I'm Sam from RateUp. {I came across|I found|I spotted} ${name} on Google and noticed you don't have a website yet &mdash; so I {went ahead and built|put together} you a sample one, on spec, just to show what it could look like.</p>
<p>No cost and no commitment &mdash; I just thought it came out nice.</p>
<p>{Want me to send it over?|Mind if I send it over?|Want me to send it across?}</p>
<p>${SIG}</p>`,
      };
    case 2:
      return {
        subject: `Re: A quick idea for ${rawName}`,
        html: `<p>{Hi|Hey|Hello} ${first},</p>
<p>Here's the sample site I put together for ${name} &#128071;</p>
<!--SCREENSHOT-->
<p>It's a real, working page &mdash; I can send the live link whenever you'd like to click around.</p>
<p>{Worth a look?|Open to a quick look?}</p>
<p>${SIG}</p>`,
      };
    case 3:
      return {
        subject: `Re: A quick idea for ${rawName}`,
        html: `<p>{Hi|Hey|Hello} ${first},</p>
<p>{In case it's easier to see it live, here's|Here's} the working sample for ${name}:</p>
${linkBlock(demoUrl)}
<p>Open it on your phone &mdash; it's fully mobile-friendly. Happy to tweak colors, photos or wording if you'd like it adjusted.</p>
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
<p>I'm Sam from RateUp. I was looking at ${name}'s website and thought it could use a refresh &mdash; so I {mocked up|put together} a modern version to show what I mean.</p>
<p>No cost, no commitment.</p>
<p>{Want me to send it across?|Want me to send it over?|Mind if I send it across?}</p>
<p>${SIG}</p>`,
      };
    case 2:
      return {
        subject: `Re: A quick thought on ${rawName}'s site`,
        html: `<p>{Hi|Hey|Hello} ${first},</p>
<p>Here's the updated version I put together for ${name} &#128071;</p>
<!--SCREENSHOT-->
<p>Same business &mdash; just a cleaner, faster, mobile-friendly look. I can send the live link whenever you want to click through.</p>
<p>${SIG}</p>`,
      };
    case 3:
      return {
        subject: `Re: A quick thought on ${rawName}'s site`,
        html: `<p>{Hi|Hey|Hello} ${first},</p>
<p>Here's the refreshed ${name} site, live so you can try it:</p>
${linkBlock(demoUrl)}
<p>Open it on your phone and compare &mdash; happy to match your branding or drop in your own photos.</p>
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

export function renderSequenceEmail(lead: SeqLead, step: SeqStep): RenderedSequenceEmail {
  const variant = variantFor(lead.call_segment);
  const rawName = lead.business_name;
  const name = esc(rawName);
  const first = esc((rawName.split(/\s+/)[0] || "there").trim());
  const demoUrl = lead.demo_url ? esc(lead.demo_url) : "";

  const { subject, html } =
    variant === "improve"
      ? improveCopy(step, rawName, name, first, demoUrl)
      : buildCopy(step, rawName, name, first, demoUrl);

  return {
    subject: resolveSpintax(subject),
    html: resolveSpintax(html),
    useScreenshot: step === 2,
    useLink: step === 3,
  };
}
