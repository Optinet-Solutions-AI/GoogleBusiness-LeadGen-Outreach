/**
 * basic-check.ts — the free built-in address check (18 Nov 2026): no paid tool, no network. Rejects addresses that
 * are clearly unusable — file names scraped from websites (logo@2x.png), typo'd webmail domains (gmial.com),
 * throwaway inboxes, placeholders (you@example.com), no-reply and website-tool addresses (…@sentry.wixpress.com).
 * Anything else passes as "unknown / non-decisive" so the domain (MX) check and any paid checker still run.
 *
 * Inputs:  an email string (syntax already checked by syntax-check.ts)
 * Outputs: StageResult + an optional plain reason code when it rejects
 * Used by: lib/services/email-validator/index.ts (runLadder, right after the syntax check)
 */
import type { StageResult } from "./types";

export type BasicReason = "not_an_email" | "typo_domain" | "disposable" | "placeholder" | "no_reply";

const FILE_TLDS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "css", "js", "pdf", "mp4"]);

const TYPO_DOMAINS = new Set([
  "gmial.com", "gmal.com", "gmai.com", "gamil.com", "gnail.com", "gmaill.com", "gmail.co", "gmail.con", "gmail.cm",
  "hotmial.com", "hotmal.com", "hotmai.com", "hotmail.co", "hotmail.con",
  "yaho.com", "yahooo.com", "yahoo.con", "yhoo.com",
  "outlok.com", "outllok.com", "outlook.con", "iclod.com", "icloud.co", "icoud.com",
]);

const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com", "yopmail.com",
  "trashmail.com", "temp-mail.org", "tempmail.com", "getnada.com", "dispostable.com", "maildrop.cc",
  "throwawaymail.com", "fakeinbox.com", "mintemail.com", "mohmal.com", "emailondeck.com", "tempail.com",
]);

const PLACEHOLDER_DOMAINS = new Set(["example.com", "example.org", "example.net", "domain.com", "yourdomain.com", "test.com", "email.test"]);
/** Website tools that leave their own addresses in a site's code (error trackers, site builders). */
const TOOL_DOMAIN_RE = /(^|\.)(sentry\.io|sentry\.wixpress\.com|sentry-next\.wixpress\.com|wixpress\.com)$/;
/**
 * Web hosts' staging / preview domains (info@site.user.sg-host.com): the site's software made the address up from
 * the server name; no mailbox is behind it. Keep in step with HOSTING_DOMAINS in lib/services/website-email.ts.
 */
const HOSTING_DOMAIN_RE =
  /(^|\.)(sg-host\.com|wpengine\.com|wpenginepowered\.com|kinsta\.cloud|cloudwaysapps\.com|pantheonsite\.io|flywheelsites\.com|myftpupload\.com|netlify\.app|vercel\.app|pages\.dev|herokuapp\.com|azurewebsites\.net|webflow\.io|wixsite\.com)$/;
const NO_REPLY_RE = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster)$/;

const reject = (reason: BasicReason): StageResult & { reason: BasicReason } => ({ status: "invalid", decisive: true, reason });

export function checkBasic(email: string): StageResult & { reason?: BasicReason } {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  const tld = domain.split(".").pop() ?? "";
  if (FILE_TLDS.has(tld)) return reject("not_an_email");
  if (TYPO_DOMAINS.has(domain)) return reject("typo_domain");
  if (DISPOSABLE.has(domain)) return reject("disposable");
  if (PLACEHOLDER_DOMAINS.has(domain) || TOOL_DOMAIN_RE.test(domain) || HOSTING_DOMAIN_RE.test(domain)) return reject("placeholder");
  if (NO_REPLY_RE.test(local)) return reject("no_reply");
  return { status: "unknown", decisive: false };
}
