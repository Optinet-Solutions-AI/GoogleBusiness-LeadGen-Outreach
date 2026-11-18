/**
 * email/ongage-events.ts — apply Ongage's bounce / unsubscribe / complaint reports to our leads (18 Nov 2026).
 *
 * Inputs:  the Ongage webhook body — a JSON array of { email, list_id, status: hard|soft|unsubscribe|complaint,
 *          esp_name } sent every 10 minutes with everything that piled up (Ongage "The Ongage Webhook"); the leads
 *          with that address that we actually emailed (the webhook is account-wide and the Ongage account is shared
 *          with other projects, so an address we never emailed is ignored)
 * Outputs: per matched lead — hard bounce: outreach_events 'email_bounced' {bounceKind:'hard'} + verification_status
 *          'invalid' (never emailed again); soft bounce: 'email_bounced' {bounceKind:'soft'}; unsubscribe:
 *          'email_unsubscribe' + lifecycle_stage 'unsubscribed'; complaint (marked as spam): 'email_complaint' +
 *          lifecycle_stage 'dnc'. Every kind stops a running email sequence. A repeat of the same report within a day
 *          (Ongage retries) is recorded once. Returns counts.
 * Used by: app/api/webhooks/ongage/route.ts
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";

const log = getLogger("ongage.events");

export type OngageStatus = "hard" | "soft" | "unsubscribe" | "complaint";

export interface OngageEvent {
  email: string;
  status: OngageStatus;
  listId: string | null;
  esp: string | null;
}

const STATUSES = new Set<OngageStatus>(["hard", "soft", "unsubscribe", "complaint"]);

/** Accepts the documented array, a single object, or { data | events: [...] }; drops anything malformed. Pure. */
export function parseOngagePayload(body: unknown): OngageEvent[] {
  const wrapped = body as { data?: unknown; events?: unknown } | null;
  const list = Array.isArray(body) ? body : Array.isArray(wrapped?.data) ? wrapped.data : Array.isArray(wrapped?.events) ? wrapped.events : body ? [body] : [];
  const out: OngageEvent[] = [];
  for (const raw of list as Record<string, unknown>[]) {
    const email = typeof raw?.email === "string" ? raw.email.trim().toLowerCase() : "";
    const status = typeof raw?.status === "string" ? (raw.status.trim().toLowerCase() as OngageStatus) : null;
    if (!email.includes("@") || !status || !STATUSES.has(status)) continue;
    out.push({
      email,
      status,
      listId: raw.list_id == null ? null : String(raw.list_id),
      esp: typeof raw.esp_name === "string" ? raw.esp_name : null,
    });
  }
  return out;
}

export interface OngageAction {
  kind: "email_bounced" | "email_unsubscribe" | "email_complaint";
  bounceKind: "hard" | "soft" | null;
  leadPatch: Record<string, string>;
}

/** What one report does to a lead. Pure. */
export function actionFor(status: OngageStatus): OngageAction {
  switch (status) {
    case "hard":
      return { kind: "email_bounced", bounceKind: "hard", leadPatch: { verification_status: "invalid" } };
    case "soft":
      return { kind: "email_bounced", bounceKind: "soft", leadPatch: {} };
    case "unsubscribe":
      return { kind: "email_unsubscribe", bounceKind: null, leadPatch: { lifecycle_stage: "unsubscribed" } };
    case "complaint":
      return { kind: "email_complaint", bounceKind: null, leadPatch: { lifecycle_stage: "dnc" } };
  }
}

export interface OngageDeps {
  /** Ids of leads with this address (any case) that we have sent at least one email to. */
  emailedLeads: (email: string) => Promise<string[]>;
  /** True when this exact report was already recorded for the lead in the last 24 hours. */
  alreadyRecorded: (leadId: string, kind: string, status: OngageStatus) => Promise<boolean>;
  record: (leadId: string, kind: string, meta: Record<string, unknown>) => Promise<void>;
  patchLead: (leadId: string, patch: Record<string, string>) => Promise<void>;
  stopSequence: (leadId: string) => Promise<void>;
}

export interface OngageSummary {
  received: number;
  applied: number;
  ignored: number;
}

export async function applyOngageEvents(events: OngageEvent[], deps: OngageDeps = defaultDeps): Promise<OngageSummary> {
  let applied = 0;
  let ignored = 0;
  for (const ev of events) {
    const leadIds = await deps.emailedLeads(ev.email);
    if (leadIds.length === 0) {
      ignored += 1;
      continue;
    }
    const action = actionFor(ev.status);
    for (const leadId of leadIds) {
      if (await deps.alreadyRecorded(leadId, action.kind, ev.status)) continue;
      await deps.record(leadId, action.kind, {
        source: "ongage",
        status: ev.status,
        to: ev.email,
        ...(action.bounceKind ? { bounceKind: action.bounceKind } : {}),
        list_id: ev.listId,
        esp: ev.esp,
      });
      if (Object.keys(action.leadPatch).length) await deps.patchLead(leadId, action.leadPatch);
      await deps.stopSequence(leadId);
      applied += 1;
    }
  }
  log.info({ received: events.length, applied, ignored }, "ongage.events.applied");
  return { received: events.length, applied, ignored };
}

/** Escape LIKE wildcards so an address is matched exactly (case-insensitively). Pure. */
export function exactILike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const defaultDeps: OngageDeps = {
  emailedLeads: async (email) => {
    const db = getDb();
    const { data: leads } = await db.from("leads").select("id").ilike("email", exactILike(email)).limit(20);
    const ids = ((leads ?? []) as { id: string }[]).map((l) => l.id);
    if (!ids.length) return [];
    const { data: sent } = await db.from("outreach_events").select("lead_id").eq("kind", "email_sent").in("lead_id", ids);
    return [...new Set(((sent ?? []) as { lead_id: string }[]).map((s) => s.lead_id))];
  },
  alreadyRecorded: async (leadId, kind, status) => {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { data } = await getDb()
      .from("outreach_events")
      .select("id")
      .eq("lead_id", leadId)
      .eq("kind", kind)
      .eq("meta->>source", "ongage")
      .eq("meta->>status", status)
      .gte("created_at", since)
      .limit(1);
    return (data ?? []).length > 0;
  },
  record: async (leadId, kind, meta) => {
    const { error } = await getDb().from("outreach_events").insert({ lead_id: leadId, kind, meta });
    if (error) throw new Error(error.message);
  },
  patchLead: async (leadId, patch) => {
    const { error } = await getDb().from("leads").update(patch).eq("id", leadId);
    if (error) throw new Error(error.message);
  },
  stopSequence: async (leadId) => {
    await getDb().from("leads").update({ seq_status: "stopped", seq_next_step_at: null }).eq("id", leadId).eq("seq_status", "active");
  },
};
