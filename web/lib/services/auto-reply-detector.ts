/**
 * auto-reply-detector.ts — classify an inbound email: human / auto / ticket,
 * plus an unsubscribe-intent flag. Pure + IO-free (easy to unit-test).
 *
 * Inputs:  { headers (lowercased name→value), subject, body }
 * Outputs: { kind, isUnsubscribe, confidence, signals }
 * Used by: app/api/email/sync/route.ts — so an out-of-office / "do-not-reply"
 *          bounce-back doesn't get flagged as a hot human reply, and an
 *          "unsubscribe" reply suppresses the lead.
 *
 * Ported (trimmed) from the email-sending-system.md §8.3 classifier.
 */

export type ReplyKind = "human" | "auto" | "ticket";

export interface ReplyVerdict {
  kind: ReplyKind;
  isUnsubscribe: boolean;
  confidence: number; // 0–1 auto-confidence
  signals: string[];
}

const TICKET_HEADERS = [
  "x-zendesk-ticket",
  "x-freshdesk-id",
  "x-helpdesk",
  "x-helpscout-conversation",
  "x-jira-fingerprint",
  "x-md-ticket",
];

const OOO_RE =
  /(out of (the )?office|automatic reply|auto[- ]?reply|auto[- ]?response|abwesenheit|absence du bureau|afwezig|en vacances|on (annual )?leave|away from my|currently away|on holiday|maternity leave|parental leave)/i;

const DO_NOT_REPLY_RE =
  /(do not reply|do-not-reply|no[- ]?reply|this is an automated|automated (message|response)|unattended mailbox|message was sent automatically)/i;

const UNSUBSCRIBE_RE =
  /\b(unsubscribe|opt[- ]?out|opt out|remove me|stop emailing|stop contacting|take me off|do not contact|please remove)\b/i;

export function classifyReply(input: {
  headers: Record<string, string>;
  subject: string;
  body: string;
}): ReplyVerdict {
  const h = (k: string) => (input.headers[k.toLowerCase()] ?? "").toLowerCase();
  const subject = (input.subject ?? "").toLowerCase();
  const body = (input.body ?? "").toLowerCase();
  const signals: string[] = [];
  let score = 0;

  // RFC-3834 / bulk auto-response headers.
  const autoSubmitted = h("auto-submitted");
  if (autoSubmitted && autoSubmitted !== "no") {
    score += 0.6;
    signals.push(`auto-submitted:${autoSubmitted}`);
  }
  if (h("x-autoreply") || h("x-autorespond") || h("x-auto-response-suppress")) {
    score += 0.6;
    signals.push("x-autoreply");
  }
  const precedence = h("precedence");
  if (["bulk", "auto_reply", "junk", "list"].includes(precedence)) {
    score += 0.3;
    signals.push(`precedence:${precedence}`);
  }

  // Ticketing systems (their visible From is often a ticket address).
  let isTicket = false;
  for (const th of TICKET_HEADERS) {
    if (h(th)) {
      isTicket = true;
      signals.push(th);
    }
  }

  // Subject / body heuristics.
  if (OOO_RE.test(subject) || OOO_RE.test(body)) {
    score += 0.5;
    signals.push("out-of-office");
  }
  if (DO_NOT_REPLY_RE.test(body) || DO_NOT_REPLY_RE.test(subject)) {
    score += 0.4;
    signals.push("do-not-reply");
  }

  const isUnsubscribe = UNSUBSCRIBE_RE.test(subject) || UNSUBSCRIBE_RE.test(body);
  if (isUnsubscribe) signals.push("unsubscribe");

  let kind: ReplyKind = "human";
  if (isTicket) kind = "ticket";
  else if (score >= 0.4) kind = "auto";

  return { kind, isUnsubscribe, confidence: Math.min(1, score), signals };
}
