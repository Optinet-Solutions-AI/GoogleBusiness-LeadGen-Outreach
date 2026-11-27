/**
 * services/link-check.ts — open one link once and say whether it works (27 Nov 2026). Free.
 *
 * Inputs:  a URL
 * Outputs: LinkCheck { url, state: ok | dead | unknown | unchecked, at } (rules: lib/leads/link-check.ts)
 * Used by: lib/pipeline/stage-1-scrape.ts (the contact page, during scraping)
 *
 * One plain GET with a normal browser identity, redirects followed, 8 seconds, never retried. Social sites are never
 * fetched ("unchecked"): they block automated checks and we never get around a block. Never throws.
 */
import "@/lib/server-guard";
import { getLogger } from "@/lib/logger";
import { linkKind, linkVerdict, type LinkCheck } from "@/lib/leads/link-check";

const log = getLogger("link-check");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function checkLink(url: string, now: Date = new Date()): Promise<LinkCheck> {
  const at = now.toISOString();
  const kind = linkKind(url);
  if (kind === "social") return { url, state: "unchecked", at };
  // A malformed link or one pointing inside a network is never opened: "couldn't check", not "dead".
  if (kind !== "web") return { url, state: "unknown", at };
  try {
    // Redirects followed by hand (at most 5), each hop checked: a public page can't bounce us to an internal address.
    let next = url;
    let res: Response | null = null;
    for (let hop = 0; hop < 5; hop++) {
      res = await fetch(next, { method: "GET", redirect: "manual", headers: { "User-Agent": UA, Accept: "text/html,*/*" }, signal: AbortSignal.timeout(8_000) });
      res.body?.cancel().catch(() => undefined); // only the status matters
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!loc) break;
      next = new URL(loc, next).toString();
      if (linkKind(next) !== "web") return { url, state: "unknown", at };
    }
    const state = linkVerdict({ status: res?.status });
    log.info({ url, status: res?.status, state }, "link_check.done");
    return { url, state, at };
  } catch (err) {
    const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
    const error = e.name === "TimeoutError" || e.name === "AbortError" ? "timeout" : `${e.cause?.code ?? ""} ${e.cause?.message ?? ""} ${e.message ?? ""}`;
    const state = linkVerdict({ error });
    log.info({ url, error: error.slice(0, 120), state }, "link_check.failed");
    return { url, state, at };
  }
}
