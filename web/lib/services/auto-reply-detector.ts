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
  /** True when this inbound is a bounce / non-delivery report (NDR). */
  isBounce: boolean;
  /** hard = address dead (stop forever); soft = transient (full mailbox, greylist). */
  bounceKind: "hard" | "soft" | null;
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

// Non-delivery report (bounce) signals.
const BOUNCE_FROM_RE = /(mailer-daemon|postmaster|mail delivery (system|subsystem))/i;
const BOUNCE_SUBJECT_RE =
  /(undeliverable|delivery status notification|mail delivery (failed|subsystem)|returned mail|failure notice|delivery has failed|message not delivered|undelivered mail|returned to sender|delivery incomplete)/i;
// Hard = the address is dead → stop forever. Soft = transient (retryable).
const HARD_BOUNCE_RE =
  /(\b5\.\d\.\d\b|user unknown|no such user|recipient (address )?rejected|mailbox (unavailable|not found|does not exist)|address (not found|rejected)|account (has been )?(disabled|deactivated|closed)|no mailbox|does not exist|unknown recipient|invalid recipient|550[ -])/i;
const SOFT_BOUNCE_RE =
  /(\b4\.\d\.\d\b|over ?quota|mailbox full|quota exceeded|temporarily|try again later|greylist|insufficient (system )?storage|message too large|421[ -]|450[ -]|452[ -])/i;

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

  // Bounce / NDR detection. A delivery report is "auto" by nature, but we flag
  // it separately so the sequence can STOP (never follow up a bad address).
  const from = h("from");
  const contentType = h("content-type");
  const fromDaemon = BOUNCE_FROM_RE.test(from);
  const ndrSubject = BOUNCE_SUBJECT_RE.test(subject);
  const ndrReport = /report-type=\s*"?delivery-status"?|multipart\/report/i.test(contentType);
  const isBounce = fromDaemon || ndrSubject || ndrReport || !!h("x-failed-recipients");
  let bounceKind: "hard" | "soft" | null = null;
  if (isBounce) {
    signals.push("bounce");
    // Classify hard vs soft from the diagnostic text; default to hard when the
    // NDR is unambiguous but unparseable (safer to stop than to keep sending).
    if (HARD_BOUNCE_RE.test(body) || HARD_BOUNCE_RE.test(subject)) bounceKind = "hard";
    else if (SOFT_BOUNCE_RE.test(body) || SOFT_BOUNCE_RE.test(subject)) bounceKind = "soft";
    else bounceKind = "hard";
    signals.push(`bounce:${bounceKind}`);
  }

  let kind: ReplyKind = "human";
  if (isBounce) kind = "auto";
  else if (isTicket) kind = "ticket";
  else if (score >= 0.4) kind = "auto";

  return { kind, isUnsubscribe, isBounce, bounceKind, confidence: Math.min(1, score), signals };
}
