/**
 * email/email-used.ts — what we record about the email a Send email used, for the scoreboard and wording tests.
 *
 * Inputs:  what the Send email window says it used ({ key, edited, testId?, variant? }); the saved template and the
 *          wording test it names (injectable lookups)
 * Outputs: resolveEmailUsed(raw) → EmailUsed (key, label, version, edited, test_id?, variant?) or null
 * Used by: app/api/leads/[id]/send-email/route.ts → lib/email/send-simple.ts (saved in outreach_events meta.email_used)
 *
 * The label is worked out here, never taken from the browser: a ready-made email gets its offer's name, a saved
 * template its name + version at the time of sending. A wording test is only kept when it is running and the email
 * really is that test's version. Nothing here stops a send: a lookup that fails just records less.
 */
import "@/lib/server-guard";
import { getLogger } from "@/lib/logger";
import { SERVICES } from "@/lib/email/service-templates";
import { getTemplate } from "@/lib/email/template-library";
import { getTest } from "@/lib/email/email-tests";
import type { EmailUsed } from "./email-results";
import { armKey, type Variant, type WordingTest } from "./wording-test";

const log = getLogger("email-used");

export interface UsedInput {
  key: string;
  edited: boolean;
  testId?: string | null;
  variant?: Variant | null;
}

export interface UsedDeps {
  template: (id: string) => Promise<{ name: string; version: number } | null>;
  test: (id: string) => Promise<WordingTest | null>;
}

const defaultDeps: UsedDeps = {
  template: (id) => getTemplate(id).then((t) => (t ? { name: t.name, version: t.version } : null)),
  test: getTest,
};

export async function resolveEmailUsed(raw: UsedInput, deps: UsedDeps = defaultDeps): Promise<EmailUsed | null> {
  let used: EmailUsed;
  if (raw.key.startsWith("service:")) {
    const offer = SERVICES.find((s) => `service:${s.key}` === raw.key);
    if (!offer) return null;
    used = { key: raw.key, label: offer.label, edited: raw.edited };
  } else if (raw.key.startsWith("saved:")) {
    const t = await deps.template(raw.key.slice("saved:".length)).catch((err) => {
      log.warn({ err: String(err) }, "email_used.template_lookup_failed");
      return null;
    });
    used = t ? { key: raw.key, label: `${t.name} (v${t.version})`, version: t.version, edited: raw.edited } : { key: raw.key, label: "A saved template", edited: raw.edited };
  } else return null;

  if (raw.testId && raw.variant) {
    const test = await deps.test(raw.testId).catch(() => null);
    if (test && test.status === "running" && armKey(test, raw.variant) === raw.key) {
      used.test_id = test.id;
      used.variant = raw.variant;
    }
  }
  return used;
}
