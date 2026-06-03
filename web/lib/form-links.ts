/**
 * form-links.ts — private one-time intake links (the link we text to an interested lead).
 *
 * Inputs:  a lead id (+ optional call_attempt id)
 * Outputs: issueFormLink → { token, formLinkId } (plaintext token returned ONCE, only the sha256
 *          is stored); getLinkByToken / markOpened / consumeFormLink for the public form route.
 * Used by: lib/pipeline/stage-6-sms.ts (issue), app/api/form/[token]/route.ts (open + consume)
 *
 * Security: 32-byte random token, hashed at rest, single-use via an atomic UPDATE latch, expiring.
 * Server-only (DB + node:crypto).
 */

import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { env } from "./config";
import { getDb } from "./db";
import { getLogger } from "./logger";

const log = getLogger("form-links");

export interface FormLinkRow {
  id: string;
  lead_id: string;
  status: "issued" | "opened" | "submitted" | "expired" | "revoked";
  expires_at: string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issue a fresh one-time link for a lead. Revokes any prior live link (keeps the partial-unique
 * "one active per lead" invariant), stores only the hash, returns the plaintext token ONCE.
 */
export async function issueFormLink(
  leadId: string,
  callAttemptId?: string | null,
  issuedBy?: string,
): Promise<{ token: string; formLinkId: string } | null> {
  const db = getDb();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + env.FORM_LINK_TTL_HOURS * 3600 * 1000).toISOString();

  // Revoke any existing live link so the partial-unique index won't collide.
  await db
    .from("form_links")
    .update({ status: "revoked" })
    .eq("lead_id", leadId)
    .in("status", ["issued", "opened"]);

  const { data, error } = await db
    .from("form_links")
    .insert({
      lead_id: leadId,
      call_attempt_id: callAttemptId ?? null,
      token_hash: tokenHash,
      status: "issued",
      expires_at: expiresAt,
      issued_by: issuedBy ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    log.warn({ leadId, err: error?.message }, "form-links.issue.failed");
    return null;
  }

  const formLinkId = (data as { id: string }).id;
  await db.from("outreach_events").insert({ lead_id: leadId, kind: "form_link_issued", meta: { form_link_id: formLinkId } });
  log.info({ leadId, formLinkId }, "form-links.issued");
  return { token, formLinkId };
}

/** Look up a link by plaintext token (hashes it first). For rendering the public form. */
export async function getLinkByToken(token: string): Promise<FormLinkRow | null> {
  const { data, error } = await getDb()
    .from("form_links")
    .select("id, lead_id, status, expires_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (error || !data) return null;
  return data as FormLinkRow;
}

/** Flip issued → opened (don't downgrade a submitted link). Best-effort. */
export async function markOpened(formLinkId: string): Promise<void> {
  await getDb()
    .from("form_links")
    .update({ status: "opened", opened_at: new Date().toISOString() })
    .eq("id", formLinkId)
    .eq("status", "issued");
}

/**
 * Atomic single-use claim: flip issued/opened → submitted IFF still valid + unexpired.
 * Returns the lead/link ids on success, or null if already used / expired / not found.
 * The single UPDATE is row-locked by Postgres, so concurrent submits can't both win.
 */
export async function consumeFormLink(
  token: string,
): Promise<{ leadId: string; formLinkId: string } | null> {
  const { data, error } = await getDb()
    .from("form_links")
    .update({ status: "submitted", consumed_at: new Date().toISOString() })
    .eq("token_hash", hashToken(token))
    .in("status", ["issued", "opened"])
    .gt("expires_at", new Date().toISOString())
    .select("id, lead_id");

  if (error) {
    log.warn({ err: error.message }, "form-links.consume.failed");
    return null;
  }
  if (!data || data.length === 0) return null; // already used / expired / unknown
  const row = data[0] as { id: string; lead_id: string };
  return { leadId: row.lead_id, formLinkId: row.id };
}
