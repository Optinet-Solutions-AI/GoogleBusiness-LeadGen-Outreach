/**
 * contact-form/runs.ts — "Contact form" attempts on a lead: start a look / a send (with the safety gates), and the
 * two Cloud Run steps that do them and record what happened.
 *
 * Inputs:  lead id / run id; the lead row, contact_form_runs (migration 065), the chosen mailbox, the kill switch,
 *          suppression; OPENAI_FORM_MODEL, OPENAI_FORM_USD_PER_MTOK_IN / _OUT
 * Outputs: contact_form_runs rows (status, screenshots in Storage `lead-screenshots/contact-forms/…`, fields, cost);
 *          on a send: outreach_events contact_form_sent / _blocked / _failed, lead stage → outreached when earlier
 * Used by: app/api/leads/[id]/contact-form/route.ts (startLook, startSend, latestRun),
 *          scripts/cloud-run-job.ts MODE=contact-form (runLookStep, runSendStep)
 *
 * Starting never triggers the worker (the route does). Only the lead's newest attempt can be sent, and the
 * ready → sending switch is one conditional update, so two clicks / two tabs can't both send. The worker takes the
 * send with its own conditional update (worker_started_at), so a duplicate worker stops; it never presses Send later
 * than 8 minutes after the click (the dashboard says "check their page" at 10). A send that dies after it started
 * is "unknown", never "failed".
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { isSuppressed } from "@/lib/suppression";
import { getSenderAccount } from "@/lib/services/email-sender";
import { EARLY_STAGES } from "@/lib/email/send-simple";
import { fillAndSubmit, formUsd, lookForm, type LookResult, type SendInput, type SendResult } from "@/lib/services/contact-form-browser";
import {
  STATUS_TEXT,
  canReuseLook,
  effectiveStatus,
  isActive,
  leadHost,
  ownContactUrl,
  senderName,
  type FormRun,
  type RunStatus,
} from "./rules";

const log = getLogger("contact-form-runs");
const BUCKET = "lead-screenshots";
const TABLE = "contact_form_runs";
export const DEFAULT_FORM_MODEL = "gpt-6.1-sol";
/** After Send is pressed, the worker must press their Send button within this, or not at all. */
export const SEND_START_LIMIT_MS = 8 * 60_000;

export interface FormLead {
  id: string;
  business_name: string;
  website_url: string | null;
  contact_page_url: string | null;
  stage: string | null;
  inbox_status: string | null;
  lifecycle_stage: string | null;
  phone: string | null;
  address: string | null;
  country_code: string | null;
}

export type StartRefusal = "no_table" | "no_lead" | "no_website" | "suppressed" | "paused" | "busy" | "not_ready" | "no_mailbox" | "empty";

export const START_TEXT: Record<StartRefusal, string> = {
  no_table: "Run database update 065 first (contact form history isn't set up yet).",
  no_lead: "Lead not found.",
  no_website: "This lead has no website or contact page to send a form on.",
  suppressed: "This lead unsubscribed or is on the do-not-contact list, so it can't be contacted.",
  paused: "Sending is paused right now (the pause switch is on).",
  busy: "A contact form attempt is already running for this lead. Wait for it to finish.",
  not_ready: "This form isn't ready to send — it may already be sending. Refresh.",
  no_mailbox: "That mailbox isn't connected. Pick another one.",
  empty: "Write a message first.",
};

type Refused = { ok: false; reason: StartRefusal; message: string };
const refuse = (reason: StartRefusal): Refused => ({ ok: false, reason, message: START_TEXT[reason] });

export interface RunsDeps {
  now: () => number;
  paused: () => boolean;
  loadLead: (id: string) => Promise<FormLead | null>;
  suppressed: (lead: FormLead) => Promise<boolean>;
  account: (senderEmail?: string) => Promise<{ email: string; fromName: string | null } | null>;
  latest: (leadId: string) => Promise<FormRun | null | "no_table">;
  getRun: (runId: string) => Promise<FormRun | null>;
  insertRun: (row: Partial<FormRun> & { lead_id: string }) => Promise<FormRun | "no_table">;
  updateRun: (id: string, patch: Partial<FormRun>) => Promise<void>;
  /** ready → sending in ONE conditional update; null when the run wasn't ready (already sending / sent). */
  claimSend: (runId: string, leadId: string, patch: Partial<FormRun>) => Promise<FormRun | null>;
  /** The worker takes a sending run: true for exactly one worker (worker_started_at was empty). */
  claimWorker: (runId: string) => Promise<boolean>;
  /** Worker didn't start: sending → ready, only if no worker has taken it. */
  releaseSend: (runId: string, at: string) => Promise<void>;
  look: (input: { siteUrl: string | null; contactUrl: string | null; host: string }) => Promise<LookResult>;
  send: (input: SendInput) => Promise<SendResult>;
  upload: (path: string, png: Buffer) => Promise<string | null>;
  insertEvent: (row: { lead_id: string; kind: string; meta: Record<string, unknown> }) => Promise<void>;
  updateLead: (id: string, patch: Record<string, unknown>) => Promise<void>;
  model: () => string;
  prices: () => { inPerMTok: number; outPerMTok: number };
}

/* ---------------------------------------------------------------- read ----------------------------------------- */

export type RunView = FormRun & { effective: RunStatus; text: string };

export async function latestRun(leadId: string, deps: RunsDeps = defaultDeps): Promise<RunView | null | "no_table"> {
  const r = await deps.latest(leadId);
  if (!r || r === "no_table") return r;
  const effective = effectiveStatus(r, deps.now());
  return { ...r, effective, text: r.reason && effective !== "ready" ? `${STATUS_TEXT[effective]} ${r.reason}` : STATUS_TEXT[effective] };
}

/* ---------------------------------------------------------------- start ---------------------------------------- */

export async function startLook(
  leadId: string,
  opts: { force?: boolean },
  deps: RunsDeps = defaultDeps,
): Promise<{ ok: true; run: FormRun; reused: boolean } | Refused> {
  const lead = await deps.loadLead(leadId);
  if (!lead) return refuse("no_lead");
  if (!leadHost(lead)) return refuse("no_website");
  if (await deps.suppressed(lead)) return refuse("suppressed");
  const prev = await deps.latest(leadId);
  if (prev === "no_table") return refuse("no_table");
  const now = deps.now();
  if (prev && isActive(prev, now)) return refuse("busy");
  if (prev && !opts.force && canReuseLook(prev, now)) return { ok: true, run: prev, reused: true };
  const run = await deps.insertRun({ lead_id: leadId, status: "looking" });
  if (run === "no_table") return refuse("no_table");
  return { ok: true, run, reused: false };
}

export async function startSend(
  leadId: string,
  input: { runId: string; senderEmail?: string; subject: string; message: string; offerKey?: string },
  deps: RunsDeps = defaultDeps,
): Promise<{ ok: true; run: FormRun } | Refused> {
  if (deps.paused()) return refuse("paused");
  const lead = await deps.loadLead(leadId);
  if (!lead) return refuse("no_lead");
  if (await deps.suppressed(lead)) return refuse("suppressed");
  if (!input.message.trim()) return refuse("empty");
  const account = await deps.account(input.senderEmail);
  if (!account) return refuse("no_mailbox");
  // Only the newest attempt: another tab's "Look again" makes an older ready attempt unsendable.
  const newest = await deps.latest(leadId);
  if (newest === "no_table") return refuse("no_table");
  if (!newest || newest.id !== input.runId) return refuse("not_ready");
  const run = await deps.claimSend(input.runId, leadId, {
    status: "sending",
    sender_email: account.email,
    sender_name: senderName(account.fromName, account.email),
    subject: input.subject.trim(),
    message: input.message.trim(),
    offer_key: input.offerKey ?? null,
    reason: null,
    updated_at: new Date(deps.now()).toISOString(),
  });
  if (!run) return refuse("not_ready");
  return { ok: true, run };
}

/** The worker didn't start: a send goes back to ready (nothing was sent, so it may be retried); a look failed. */
export async function markStartFailed(runId: string, step: "look" | "send", deps: RunsDeps = defaultDeps): Promise<void> {
  const updated_at = new Date(deps.now()).toISOString();
  if (step === "send") await deps.releaseSend(runId, updated_at);
  else await deps.updateRun(runId, { status: "failed", reason: "Couldn't start the worker. Try again.", updated_at });
}

/* ---------------------------------------------------------------- job steps ------------------------------------ */

const shotPath = (run: FormRun, kind: "form" | "filled" | "result") => `contact-forms/${run.lead_id}/${run.id}-${kind}.png`;

export async function runLookStep(runId: string, deps: RunsDeps = defaultDeps): Promise<void> {
  const run = await deps.getRun(runId);
  if (!run || run.status !== "looking") return;
  const stamp = () => new Date(deps.now()).toISOString();
  try {
    const lead = await deps.loadLead(run.lead_id);
    const host = lead ? leadHost(lead) : null;
    if (!lead || !host) {
      await deps.updateRun(run.id, { status: "no_form", reason: START_TEXT.no_website, updated_at: stamp() });
      return;
    }
    const r = await deps.look({ siteUrl: lead.website_url, contactUrl: ownContactUrl(lead), host });
    const shot = r.shot ? await deps.upload(shotPath(run, "form"), r.shot) : null;
    await deps.updateRun(run.id, { status: r.status, contact_url: r.contactUrl, form_shot_url: shot, reason: r.reason, updated_at: stamp() });
    log.info({ run_id: run.id, lead_id: run.lead_id, status: r.status }, "contact_form.look_done");
  } catch (e) {
    log.warn({ run_id: run.id, err: String(e).slice(0, 200) }, "contact_form.look_failed");
    await deps.updateRun(run.id, { status: "failed", reason: "Couldn't open their page.", updated_at: stamp() });
  }
}

export async function runSendStep(runId: string, deps: RunsDeps = defaultDeps): Promise<void> {
  const run = await deps.getRun(runId);
  if (!run || run.status !== "sending") return;
  const stamp = () => new Date(deps.now()).toISOString();
  if (!(await deps.claimWorker(run.id))) {
    log.warn({ run_id: run.id }, "contact_form.duplicate_worker");
    return;
  }
  const claimedAt = Date.parse(run.updated_at);
  if (deps.now() - claimedAt > SEND_START_LIMIT_MS) {
    await deps.updateRun(run.id, { status: "failed", reason: "The worker started too late, so it didn't send. Nothing was sent; try again.", updated_at: stamp() });
    return;
  }
  let lead: FormLead | null = null;
  try {
    lead = await deps.loadLead(run.lead_id);
    const host = lead ? leadHost(lead) : null;
    if (!lead || !host || !run.contact_url || !run.sender_email || !run.message) {
      await deps.updateRun(run.id, { status: "failed", reason: "Details were missing, so nothing was sent.", updated_at: stamp() });
      return;
    }
    const r = await deps.send({
      contactUrl: run.contact_url,
      host,
      businessName: lead.business_name,
      senderName: run.sender_name ?? senderName(null, run.sender_email),
      senderEmail: run.sender_email,
      subject: run.subject ?? "",
      message: run.message,
      model: deps.model(),
      deadline: claimedAt + SEND_START_LIMIT_MS,
    });
    const filled = r.filledShot ? await deps.upload(shotPath(run, "filled"), r.filledShot) : null;
    const result = r.resultShot ? await deps.upload(shotPath(run, "result"), r.resultShot) : null;
    const usd = formUsd(r.usage, deps.prices());
    const status: RunStatus = r.outcome;
    const meta = {
      run_id: run.id, contact_url: run.contact_url, via: run.sender_email, offer_key: run.offer_key, subject: run.subject,
      reason: r.reason, fields: r.fields, filled_shot_url: filled, result_shot_url: result, screenshot_url: result ?? filled, usd,
    };
    if (status === "sent") {
      await deps.insertEvent({ lead_id: lead.id, kind: "contact_form_sent", meta: { ...meta, sent: true } });
      const patch: Record<string, unknown> = {};
      if (lead.stage && EARLY_STAGES.has(lead.stage)) patch.stage = "outreached";
      if (!lead.inbox_status || lead.inbox_status === "none") patch.inbox_status = "open";
      if (Object.keys(patch).length) await deps.updateLead(lead.id, patch);
    } else if (status === "blocked" || status === "no_form") {
      await deps.insertEvent({ lead_id: lead.id, kind: "contact_form_blocked", meta: { ...meta, sent: false } });
    } else if (status === "failed") {
      await deps.insertEvent({ lead_id: lead.id, kind: "contact_form_failed", meta: { ...meta, sent: false } });
    }
    await deps.updateRun(run.id, {
      status, reason: r.reason, fields: r.fields, filled_shot_url: filled, result_shot_url: result, usd,
      sent_at: status === "sent" ? stamp() : null, updated_at: stamp(),
    });
    log.info({ run_id: run.id, lead_id: lead.id, status, usd }, "contact_form.send_done");
  } catch (e) {
    // The browser step may already have clicked send: never "failed" (a retry could send twice).
    log.warn({ run_id: run.id, err: String(e).slice(0, 200) }, "contact_form.send_crashed");
    await deps.updateRun(run.id, { status: "unknown", reason: "Something went wrong while sending.", updated_at: stamp() });
  }
}

/* ---------------------------------------------------------------- real deps ------------------------------------ */

function isMissingTable(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "PGRST205" || (/contact_form_runs/.test(err.message ?? "") && /does not exist|could not find/i.test(err.message ?? ""));
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
const LEAD_COLS = "id,business_name,website_url,contact_page_url,stage,inbox_status,lifecycle_stage,phone,address,country_code";

const defaultDeps: RunsDeps = {
  now: () => Date.now(),
  paused: () => {
    const until = process.env.EMAIL_SENDING_PAUSED_UNTIL;
    return Boolean(until && Date.parse(until) > Date.now());
  },
  loadLead: async (id) => {
    const { data } = await getDb().from("leads").select(LEAD_COLS).eq("id", id).maybeSingle();
    return (data as FormLead | null) ?? null;
  },
  suppressed: (lead) => isSuppressed(lead, "email"),
  account: async (senderEmail) => {
    const a = await getSenderAccount(senderEmail).catch(() => null);
    return a ? { email: a.email, fromName: a.fromName ?? null } : null;
  },
  latest: async (leadId) => {
    const { data, error } = await getDb().from(TABLE).select("*").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) {
      if (isMissingTable(error)) return "no_table";
      throw new Error(error.message);
    }
    return (data as FormRun | null) ?? null;
  },
  getRun: async (runId) => {
    const { data } = await getDb().from(TABLE).select("*").eq("id", runId).maybeSingle();
    return (data as FormRun | null) ?? null;
  },
  insertRun: async (row) => {
    const { data, error } = await getDb().from(TABLE).insert(row).select("*").single();
    if (error) {
      if (isMissingTable(error)) return "no_table";
      throw new Error(error.message);
    }
    return data as FormRun;
  },
  updateRun: async (id, patch) => {
    const { error } = await getDb().from(TABLE).update(patch).eq("id", id);
    if (error) log.warn({ run_id: id, err: error.message }, "contact_form.update_failed");
  },
  claimSend: async (runId, leadId, patch) => {
    const { data, error } = await getDb()
      .from(TABLE)
      .update(patch)
      .eq("id", runId)
      .eq("lead_id", leadId)
      .eq("status", "ready")
      .select("*");
    if (error) throw new Error(error.message);
    return ((data as FormRun[] | null) ?? [])[0] ?? null;
  },
  claimWorker: async (runId) => {
    const { data, error } = await getDb()
      .from(TABLE)
      .update({ worker_started_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("status", "sending")
      .is("worker_started_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    return ((data as unknown[] | null) ?? []).length === 1;
  },
  releaseSend: async (runId, at) => {
    const { error } = await getDb()
      .from(TABLE)
      .update({ status: "ready", reason: null, updated_at: at })
      .eq("id", runId)
      .eq("status", "sending")
      .is("worker_started_at", null);
    if (error) log.warn({ run_id: runId, err: error.message }, "contact_form.release_failed");
  },
  look: lookForm,
  send: fillAndSubmit,
  upload: async (path, png) => {
    const db = getDb();
    const { error } = await db.storage.from(BUCKET).upload(path, png, { contentType: "image/png", upsert: true });
    if (error) {
      log.warn({ path, err: error.message }, "contact_form.upload_failed");
      return null;
    }
    return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  },
  insertEvent: async (row) => {
    const { error } = await getDb().from("outreach_events").insert(row);
    if (error) log.warn({ lead_id: row.lead_id, err: error.message }, "contact_form.event_failed");
  },
  updateLead: async (id, patch) => {
    const { error } = await getDb().from("leads").update(patch).eq("id", id);
    if (error) log.warn({ lead_id: id, err: error.message }, "contact_form.lead_update_failed");
  },
  model: () => process.env.OPENAI_FORM_MODEL || DEFAULT_FORM_MODEL,
  // GPT-6.1 Sol list price (Nov 2026): $2 in / $10 out per million tokens.
  prices: () => ({ inPerMTok: num(process.env.OPENAI_FORM_USD_PER_MTOK_IN, 2), outPerMTok: num(process.env.OPENAI_FORM_USD_PER_MTOK_OUT, 10) }),
};
