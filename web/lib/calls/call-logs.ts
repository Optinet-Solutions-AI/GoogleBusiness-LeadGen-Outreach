/**
 * calls/call-logs.ts — the Call logs list, one call with its transcript, and a signed link to its recording.
 *
 * Inputs:  filters from the page (agent, result, dates, test numbers only, page); call_attempts (provider 'voizo')
 *          joined to leads; the private call-recordings bucket
 * Outputs: CallLogRow[] (labels and recording message already worked out), one call + transcript, a 1-hour link
 * Used by: app/api/calls/** (Outreach → Call logs, the CRM panel's "Listen · transcript")
 */
import "@/lib/server-guard";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { RECORDINGS_BUCKET } from "./recording-capture";
import { agentLabel, downloadName, isTestCall, recordingMessage, resultLabel, RESULT_FILTERS, type ResultFilter } from "./recordings";

export const PAGE_SIZE = 50;
const LINK_SECONDS = 3600;

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s));

export interface CallLogFilters {
  agent?: string;
  result?: ResultFilter;
  from?: string;
  to?: string;
  test?: true;
  page: number;
}

/** Read the filters; anything invalid is dropped. Pure. */
export function parseCallLogFilters(q: URLSearchParams): CallLogFilters {
  const out: CallLogFilters = { page: 1 };
  const agent = q.get("agent")?.trim();
  if (agent && agent.length <= 100) out.agent = agent;
  const result = q.get("result");
  if (result && Object.prototype.hasOwnProperty.call(RESULT_FILTERS, result)) out.result = result as ResultFilter;
  for (const k of ["from", "to"] as const) {
    const v = q.get(k);
    if (v && isoDay.safeParse(v).success) out[k] = v;
  }
  if (q.get("test") === "1") out.test = true;
  const page = Number(q.get("page"));
  if (Number.isInteger(page) && page >= 1) out.page = page;
  return out;
}

export interface CallLogRow {
  id: string;
  leadId: string;
  business: string;
  createdAt: string;
  endedAt: string | null;
  phone: string | null;
  isTest: boolean;
  agent: string;
  result: string;
  durationSec: number | null;
  hasTranscript: boolean;
  recording: { kind: "ready" | "pending" | "none"; text: string };
}

interface Row {
  id: string;
  lead_id: string;
  status: string;
  outcome: string | null;
  duration_sec: number | null;
  created_at: string;
  ended_at: string | null;
  recording_url: string | null;
  transcript: string | null;
  meta: Record<string, unknown> | null;
  leads: { business_name: string | null; phone: string | null; country_code: string | null } | null;
}

const COLS = "id,lead_id,status,outcome,duration_sec,created_at,ended_at,recording_url,transcript,meta,leads(business_name,phone,country_code)";

function toRow(r: Row, now: number): CallLogRow {
  const meta = r.meta ?? {};
  return {
    id: r.id,
    leadId: r.lead_id,
    business: r.leads?.business_name ?? "(deleted lead)",
    createdAt: r.created_at,
    endedAt: r.ended_at,
    phone: typeof meta.phone === "string" ? meta.phone : null,
    isTest: isTestCall(meta, r.leads?.phone ?? null, r.leads?.country_code ?? null),
    agent: agentLabel(meta),
    result: resultLabel(r),
    durationSec: r.duration_sec,
    hasTranscript: Boolean(r.transcript?.trim()),
    // The web app can't see the Cloud Run job's settings, so "no key" isn't judged here (the worker logs it).
    recording: recordingMessage({
      recordingUrl: r.recording_url,
      state: typeof meta.recording_state === "string" ? meta.recording_state : null,
      hasVapiId: typeof meta.vapi_call_id === "string" && meta.vapi_call_id !== "",
      endedAt: r.ended_at ?? r.created_at,
      now,
      keySet: true,
    }),
  };
}

export async function listCallLogs(f: CallLogFilters): Promise<{ rows: CallLogRow[]; total: number; agents: { id: string; name: string }[] }> {
  const db = getDb();
  let q = db.from("call_attempts").select(COLS, { count: "exact" }).eq("provider", "voizo");
  if (f.agent === "default") q = q.is("meta->>voizo_campaign_id", null);
  else if (f.agent) q = q.eq("meta->>voizo_campaign_id", f.agent);
  if (f.result) {
    const rf: { outcome?: string; status?: readonly string[] } = RESULT_FILTERS[f.result];
    if (rf.outcome) q = q.eq("outcome", rf.outcome);
    if (rf.status) q = q.in("status", [...rf.status]);
  }
  if (f.from) q = q.gte("created_at", `${f.from}T00:00:00Z`);
  if (f.to) q = q.lt("created_at", new Date(Date.parse(`${f.to}T00:00:00Z`) + 86_400_000).toISOString());
  if (f.test) q = q.eq("meta->>test_number", "true");
  const start = (f.page - 1) * PAGE_SIZE;
  const { data, error, count } = await q.order("created_at", { ascending: false }).range(start, start + PAGE_SIZE - 1);
  if (error) throw new Error(error.message);

  const { data: agentRows } = await db.from("voice_agents").select("name,voizo_campaign_id").order("name");
  const agents = ((agentRows ?? []) as { name: string; voizo_campaign_id: string }[]).map((a) => ({ id: a.voizo_campaign_id, name: a.name }));
  const now = Date.now();
  return { rows: ((data ?? []) as unknown as Row[]).map((r) => toRow(r, now)), total: count ?? 0, agents };
}

export async function getCallLog(id: string): Promise<(CallLogRow & { transcript: string | null }) | null> {
  const { data, error } = await getDb().from("call_attempts").select(COLS).eq("id", id).eq("provider", "voizo").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as unknown as Row;
  return { ...toRow(r, Date.now()), transcript: r.transcript };
}

/** A 1-hour signed link to the stored recording; `download` names the file "<business>-<date>.<ext>". */
export async function recordingLink(id: string, download: boolean): Promise<{ url: string } | null> {
  const call = await getDb()
    .from("call_attempts")
    .select("recording_url,created_at,leads(business_name)")
    .eq("id", id)
    .maybeSingle();
  const row = call.data as { recording_url: string | null; created_at: string; leads: { business_name: string | null } | null } | null;
  if (!row?.recording_url) return null;
  const ext = row.recording_url.split(".").pop() ?? "wav";
  const { data, error } = await getDb()
    .storage.from(RECORDINGS_BUCKET)
    .createSignedUrl(row.recording_url, LINK_SECONDS, download ? { download: downloadName(row.leads?.business_name ?? "", row.created_at, ext) } : undefined);
  if (error || !data?.signedUrl) return null;
  return { url: data.signedUrl };
}
