/**
 * email/service-templates.ts — a ready-made email (+ follow-ups) for each service we offer, filled in for one lead.
 *
 * Inputs:  the service picked in the Send email window + the lead's details (name, owner, city, niche, demo link,
 *          trade show) and the sender's name
 * Outputs: { subject, body, followUps } as plain text — the operator edits it before sending
 * Used by: components/outreach/SimpleEmailModal.tsx (the "What are you offering?" list),
 *          lib/email/compose-context.ts (default service), lib/email/service-templates.test.ts
 *
 * Pure (no server imports) so the window fills instantly. Plain text: the server turns blank lines into
 * paragraphs. Short, one question, no links except our own demo site, no words that trip spam filters, and
 * never a claim we haven't checked (we don't say their site is bad or that they rank low).
 */

export type ServiceKey =
  | "website_build"
  | "website_redesign"
  | "ai_receptionist"
  | "ai_booking"
  | "seo"
  | "buy_inventory"
  | "booth_build"
  | "reputation_mgmt"
  | "custom";

export const SERVICES: { key: ServiceKey; label: string }[] = [
  { key: "website_build", label: "New website" },
  { key: "website_redesign", label: "Website redesign" },
  { key: "ai_receptionist", label: "AI voice agent (answers their calls)" },
  { key: "ai_booking", label: "AI booking / calendar agent" },
  { key: "seo", label: "SEO (show up higher on Google)" },
  { key: "buy_inventory", label: "We buy their inventory (closing business)" },
  { key: "booth_build", label: "Exhibition stand (trade-show exhibitor)" },
  { key: "reputation_mgmt", label: "Reputation management (low review rating)" },
  { key: "custom", label: "Write my own" },
];

/** Days between the first email and each follow-up (4 → day 4, day 8). Same rhythm as the classic sequence. */
export const FOLLOW_UP_GAP_DAYS = 4;

/** Follow-ups go out as replies in the same thread. */
export function replySubject(subject: string): string {
  const s = subject.trim();
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

/** A follow-up's subject: its own when the operator wrote one, else a reply to the first email (same thread). */
export function followUpSubject(own: string | null | undefined, firstSubject: string): string {
  return (own ?? "").trim() || replySubject(firstSubject);
}

/** Most follow-ups in one plan (Send email, batch email, saved templates). */
export const MAX_FOLLOW_UPS = 3;

export function isServiceKey(v: unknown): v is ServiceKey {
  return typeof v === "string" && SERVICES.some((s) => s.key === v);
}

export interface TemplateLead {
  businessName: string;
  /** Owner / contact person (full name is fine — only the first name is used). */
  ownerName?: string | null;
  city?: string | null;
  /** Google category or niche, e.g. "Plumber". */
  category?: string | null;
  demoUrl?: string | null;
  /** Exhibitor leads: the show and stand. */
  eventName?: string | null;
  booth?: string | null;
  /** Review-site leads: the site ("Trustpilot" / "TripAdvisor"), their rating and number of reviews there. */
  platform?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  /** The sending mailbox's display name ("Sam Cole") — signs the email. */
  senderName?: string | null;
  /** How the email opens (Meny, 25 Nov 2026): no name by default; or "Hey {business} team"; or the contact's first name. */
  greeting?: GreetingStyle;
}

export type GreetingStyle = "none" | "business" | "contact";

export interface ServiceEmail {
  subject: string;
  body: string;
  /** Up to three follow-ups, sent 4, 8 and 12 days later, only if they don't reply (3 since 25 Nov 2026). */
  followUps: [string, string, string];
}

/** The service that fits the lead's segment: what the automated outreach would have pitched. */
export function defaultService(segment: string | null | undefined): ServiceKey {
  switch (segment) {
    case "no_website":
      return "website_build";
    case "old_website":
      return "website_redesign";
    case "has_website":
      return "ai_receptionist";
    case "liquidation":
      return "buy_inventory";
    case "exhibitor":
      return "booth_build";
    case "reputation":
      return "reputation_mgmt";
    default:
      return "custom";
  }
}

function firstWord(s: string | null | undefined): string | null {
  const w = (s ?? "").trim().split(/\s+/)[0];
  return w ? w : null;
}

/** "Hi Dana," when we know the owner, else "Hi there,". */
function greeting(l: TemplateLead): string {
  return greetingLine(l);
}

/** The opening line for a greeting choice: "Hi there," (default), "Hey {business} team," or "Hi {first name},". */
export function greetingLine(l: Pick<TemplateLead, "businessName" | "ownerName" | "greeting">): string {
  if (l.greeting === "business" && l.businessName.trim()) return `Hey ${l.businessName.trim()} team,`;
  const first = l.greeting === "contact" ? firstWord(l.ownerName) : null;
  return `Hi ${first ?? "there"},`;
}

/** Switch the greeting in text already in the window: only when its first line is the old greeting. */
export function swapGreeting(text: string, from: string, to: string): string {
  const nl = text.indexOf("\n");
  const first = nl === -1 ? text : text.slice(0, nl);
  return first.trim() === from ? to + (nl === -1 ? "" : text.slice(nl)) : text;
}

function signOff(l: TemplateLead): string {
  const me = firstWord(l.senderName);
  // "Best regards" since 26 Nov 2026 (operator: a proper closing remark on every email).
  return me ? `Best regards,\n${me}` : "Best regards";
}

function inCity(l: TemplateLead): string {
  const c = (l.city ?? "").split(",")[0].trim();
  return c ? ` in ${c}` : "";
}

function niche(l: TemplateLead, fallback: string): string {
  const c = (l.category ?? "").trim().toLowerCase();
  return c || fallback;
}

function join(...parts: string[]): string {
  return parts.filter((p) => p !== "").join("\n\n");
}

export function serviceEmail(key: ServiceKey, l: TemplateLead): ServiceEmail {
  const biz = l.businessName.trim() || "your business";
  const hi = greeting(l);
  const bye = signOff(l);
  const demo = (l.demoUrl ?? "").trim();

  switch (key) {
    case "website_build":
      return {
        subject: `A website for ${biz}`,
        body: join(
          hi,
          `I came across ${biz} on Google${inCity(l)} and couldn't find a website for you. Most people look a business up online before they call, so a simple site can bring in work you're missing today.`,
          demo
            ? `I went ahead and made a sample so you can see what it could look like:\n${demo}\n\nIt's on us, with nothing to sign.`
            : "I build clean, fast websites for local businesses, and I'm happy to make you a sample first, on us, so you can see it before deciding anything.",
          demo ? "What do you think?" : "Would you like me to put one together?",
          bye,
        ),
        followUps: [
          join(
            hi,
            demo
              ? `Just checking you saw the sample site I made for ${biz}:\n${demo}`
              : `Just checking you saw my note about a website for ${biz}. I'm still happy to make you a sample first, on us.`,
            "Happy to change anything on it.",
            bye,
          ),
          join(
            hi,
            demo
              ? "One thing I didn't mention: we look after the hosting and any changes, so there's nothing technical for you to do."
              : `One thing I didn't mention: we look after the hosting and any changes, so there's nothing technical for you to do. A sample for ${biz} takes me a day or two.`,
            bye,
          ),
          join(
            hi,
            `I'll leave it here so I don't fill your inbox. If a website for ${biz} becomes a priority, just reply to this email and I'll help.`,
            bye,
          ),
        ],
      };

    case "website_redesign":
      return {
        subject: `Your website, ${biz}`,
        body: join(
          hi,
          `I had a look at the ${biz} website. I think it could be working harder for you: most visitors arrive on a phone, and a faster, cleaner site usually turns more of them into calls.`,
          demo
            ? `I made a sample of a refreshed version so you can compare:\n${demo}`
            : "I rebuild websites for local businesses so they look modern, load fast and make it easy to call or book. I'm happy to make you a sample of a refreshed version first, on us.",
          demo ? "What do you think?" : "Would you like to see one?",
          bye,
        ),
        followUps: [
          join(
            hi,
            demo
              ? `Following up on the refreshed site I made for ${biz}:\n${demo}`
              : `Following up on my note about refreshing the ${biz} website. I'm still happy to make you a sample first, on us.`,
            "Would it be useful to see it side by side with your current site?",
            bye,
          ),
          join(
            hi,
            "One quick thought: you keep your web address and email, and the new site goes live without any downtime, so customers only notice a better site.",
            bye,
          ),
          join(
            hi,
            `I'll stop here so I don't crowd your inbox. If you ever want a fresh look for the ${biz} site, just reply and I'll help.`,
            bye,
          ),
        ],
      };

    case "ai_receptionist":
      return {
        subject: `Missed calls at ${biz}`,
        body: join(
          hi,
          `When ${biz} is busy or closed, what happens to the calls nobody can pick up? Most callers don't leave a message, they just try the next business.`,
          "We set up an AI receptionist that answers every call, day or night, in a natural voice. It answers common questions, takes the caller's details, books them in and sends you a summary. You keep your current number.",
          "Would you like to hear a short demo call?",
          bye,
        ),
        followUps: [
          join(
            hi,
            `Following up on the AI receptionist for ${biz}. It takes about a week to set up and works alongside your team, picking up the calls you miss.`,
            "Should I send you a demo call to listen to?",
            bye,
          ),
          join(
            hi,
            `One quick thought: it can also text back anyone who calls after hours, so they know ${biz} will get back to them instead of calling someone else.`,
            bye,
          ),
          join(
            hi,
            "I'll leave it here so I don't fill your inbox. If missed calls ever become a headache, just reply and I'll show you how it works.",
            bye,
          ),
        ],
      };

    case "ai_booking":
      return {
        subject: `Bookings for ${biz}`,
        body: join(
          hi,
          `Right now, someone who wants to book with ${biz} probably has to call or message and wait for a reply. Some give up and book somewhere else.`,
          "We set up an AI booking assistant that answers customers on your website, Facebook or WhatsApp, answers their questions and puts the appointment straight into your calendar, any time of day.",
          `Would it help if I showed you how it would work for ${biz}?`,
          bye,
        ),
        followUps: [
          join(
            hi,
            `Following up on the booking assistant for ${biz}. It works with the calendar you already use, and you can see and change every booking.`,
            "Want me to send a short walkthrough?",
            bye,
          ),
          join(
            hi,
            "One quick thought: it also sends a reminder before each appointment, which cuts down on no-shows.",
            bye,
          ),
          join(
            hi,
            "I'll stop here so I don't crowd your inbox. If you'd like customers to book themselves in later on, just reply and I'll help.",
            bye,
          ),
        ],
      };

    case "seo":
      return {
        subject: `${biz} on Google`,
        body: join(
          hi,
          `I was looking at how ${biz} shows up when people search for a ${niche(l, "business like yours")}${inCity(l)}. Most customers choose from the first few results, so moving up even a few places can bring in noticeably more calls.`,
          "We help local businesses rank higher on Google Maps and in search: your Google profile, your website and your reviews, with a short report every month.",
          `Would you like a short check of where ${biz} stands today and what would move it up? It's on us.`,
          bye,
        ),
        followUps: [
          join(
            hi,
            `Following up on the Google check for ${biz}. It's a short list of what's helping you and what's holding you back, yours to keep either way.`,
            "Should I put it together?",
            bye,
          ),
          join(
            hi,
            "One quick thought: your Google reviews and profile photos count for a lot in the local results, and they're usually the quickest things to improve.",
            bye,
          ),
          join(
            hi,
            "I'll leave it here so I don't fill your inbox. If getting found on Google becomes a priority, just reply and I'll help.",
            bye,
          ),
        ],
      };

    case "buy_inventory":
      return {
        subject: `Remaining inventory at ${biz}`,
        body: join(
          hi,
          `I understand ${biz} is closing or consolidating a location. We buy remaining and surplus inventory from businesses in that position: stock, fixtures and equipment. We can move quickly and handle the pickup.`,
          "Is there inventory you still need to clear?",
          bye,
          `Not the right person, or not interested? Just reply "no" and I won't email again.`,
        ),
        followUps: [
          join(
            hi,
            `Following up on my note about the remaining inventory at ${biz}. If it helps, send a rough list or a few photos and I'll come back with an offer.`,
            bye,
          ),
          join(hi, "We can take all of it or just part of it, and we work around your closing date.", bye),
          join(
            hi,
            "I'll stop here. If you still have stock or equipment to clear later on, just reply and we'll take a look.",
            bye,
          ),
        ],
      };

    case "reputation_mgmt": {
      const site = (l.platform ?? "").trim() || "review site";
      const why =
        /tripadvisor/i.test(site)
          ? "travellers sort by rating before they book, so a low score quietly sends them to the place next door"
          : /trustpilot/i.test(site)
            ? "most buyers check a company's TrustScore before they trust it with an order"
            : "most people check the rating before they choose, so a low score sends them to a competitor";
      const score = typeof l.rating === "number" && l.rating > 0 ? `${l.rating}★` : null;
      const count = typeof l.reviewCount === "number" && l.reviewCount > 0 ? `${l.reviewCount} reviews` : null;
      const stats = [score, count].filter(Boolean).join(" from ");
      return {
        subject: `${biz}'s ${site} rating`,
        body: join(
          hi,
          `I came across ${biz} on ${site}${stats ? ` (${stats})` : ""}. On ${site}, ${why}.`,
          "At OptiRate we help businesses turn that around: we answer reviews the right way, win back unhappy customers and bring in fresh, genuine reviews from happy ones.",
          "Would a short call to show you how we'd lift your rating be useful?",
          bye,
          `Not the right person, or not interested? Just reply "no" and I won't email again.`,
        ),
        followUps: [
          join(
            hi,
            `Following up on ${biz}'s ${site} rating. A few better reviews at the top of the page change what new customers see first. Happy to walk you through how we'd do it.`,
            bye,
          ),
          join(hi, "One quick thought: new customers read how a business answers complaints, not just the stars, so replying to older reviews helps too.", bye),
          join(hi, "I'll stop here so I don't crowd your inbox. If your reviews become a priority, just reply and I'll help.", bye),
        ],
      };
    }
    case "booth_build": {
      const event = (l.eventName ?? "").trim();
      const booth = (l.booth ?? "").trim();
      const where = event ? `at ${event}${booth ? ` (stand ${booth})` : ""}` : "at a recent trade show";
      return {
        subject: event ? `Your stand at ${event}` : "Your next exhibition stand",
        body: join(
          hi,
          `I saw ${biz} exhibiting ${where}. We design and build custom exhibition stands across Europe: design, production, transport and installation, and we're often better value than the builder you use today.`,
          "Is there a show coming up where you'd like a quote for the stand?",
          bye,
          `Not the right person, or not interested? Just reply "no" and I won't email again.`,
        ),
        followUps: [
          join(
            hi,
            `Following up on a stand for ${biz}'s next show. If you send the show name and the size of the space, I'll come back with a design idea and a price.`,
            bye,
          ),
          join(hi, "One more idea: a stand can be built to reuse and adapt across several shows a year, which brings the cost per show down.", bye),
          join(
            hi,
            "I'll stop here so I don't crowd your inbox. When the next show comes up, just reply and we'll quote it.",
            bye,
          ),
        ],
      };
    }

    case "custom":
    default:
      return {
        subject: "",
        body: `${hi}\n\n\n\n${bye}`,
        followUps: [
          join(hi, "Just following up on my last email. Did you get a chance to read it?", bye),
          join(hi, "Just a quick nudge in case my last email got buried. Happy to answer any questions.", bye),
          join(hi, "I'll leave it here so I don't fill your inbox. If it's ever useful, just reply to this email.", bye),
        ],
      };
  }
}
