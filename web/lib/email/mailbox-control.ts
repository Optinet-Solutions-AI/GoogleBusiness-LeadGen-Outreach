/**
 * email/mailbox-control.ts — Pause / Resume a sending mailbox by hand (27 Nov 2026, workflow watch_mailbox_health.md).
 *
 * Inputs:  a mailbox id, pause or resume, the time
 * Outputs: email_accounts status + paused_reason / paused_by / paused_at, or on Resume status 'active' + resumed_at
 *          (the health window starts again then); { ok, email } or { ok: false, status, message }
 * Used by: app/api/email-accounts/[id]/route.ts (PATCH { action: "pause" | "resume" })
 *
 * Resume is the only way a mailbox the app paused comes back (operator, 27 Nov 2026).
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";

const log = getLogger("mailbox-control");
const MISSING_077 = "Run database update 077 first (mailbox pause).";

/** The one write this needs (a stub in tests). */
export interface ControlDb {
  update(id: string, patch: Record<string, unknown>): Promise<{ data: { email: string } | null; error: { message: string } | null }>;
  /** The mailbox's status now (Resume is refused for a broken login). */
  status?(id: string): Promise<string | null>;
}

const realDb: ControlDb = {
  update: async (id, patch) => {
    const { data, error } = await getDb().from("email_accounts").update(patch).eq("id", id).select("email").maybeSingle();
    return { data: (data as { email: string } | null) ?? null, error: error ? { message: error.message } : null };
  },
  status: async (id) => {
    const { data } = await getDb().from("email_accounts").select("status").eq("id", id).maybeSingle();
    return (data as { status?: string } | null)?.status ?? null;
  },
};

export async function setMailboxPaused(
  id: string,
  pause: boolean,
  now: Date = new Date(),
  db: ControlDb = realDb,
): Promise<{ ok: true; email: string } | { ok: false; status: number; message: string }> {
  const at = now.toISOString();
  // A login problem isn't fixed by Resume: the mailbox needs reconnecting.
  if (!pause && db.status && (await db.status(id)) === "error") {
    return { ok: false, status: 409, message: "This mailbox has a login problem: reconnect it on this page instead of resuming it." };
  }
  const patch = pause
    ? { status: "paused", paused_by: "operator", paused_reason: "Paused by you", paused_at: at }
    : { status: "active", paused_reason: null, paused_by: null, paused_at: null, resumed_at: at };
  const { data, error } = await db.update(id, patch);
  if (error) {
    if (/paused_|resumed_at/.test(error.message)) return { ok: false, status: 503, message: MISSING_077 };
    return { ok: false, status: 502, message: error.message.slice(0, 200) };
  }
  if (!data) return { ok: false, status: 404, message: "Mailbox not found" };
  log.info({ mailbox: data.email, pause }, pause ? "mailbox.paused_by_operator" : "mailbox.resumed");
  return { ok: true, email: data.email };
}
