/**
 * route.ts — POST /api/email-accounts/bluehost
 *
 * Inputs:  { email, fromName?, password, smtpHost?, smtpPort?, imapHost?, imapPort? }
 * Outputs: { success, data: email_accounts row, warning? }
 * Used by: ConnectMailboxModal frontend component (any provider via presets)
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { getDb } from "../../../../lib/db";
import { getLogger } from "../../../../lib/logger";
import { ok, fail } from "../../../../lib/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = getLogger("email-accounts.bluehost");

const Body = z.object({
  email: z.string().email(),
  fromName: z.string().optional(),
  password: z.string().min(1),
  provider: z.string().optional(),
  smtpHost: z.string().default("smtp.titan.email"),
  smtpPort: z.coerce.number().default(465),
  imapHost: z.string().default("imap.titan.email"),
  imapPort: z.coerce.number().default(993),
});

export async function POST(req: NextRequest) {
  try {
    let body: z.infer<typeof Body>;
    try {
      body = Body.parse(await req.json());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Invalid request body";
      return fail(msg, 400);
    }

    const { email, fromName, password, provider, smtpHost, smtpPort, imapHost, imapPort } = body;

    // ── Step A: Verify SMTP (hard gate) ─────────────────────────────────────
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: email, pass: password },
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
      await transporter.verify();
      transporter.close();
      log.info({ email }, "bluehost.smtp.verified");
    } catch (e: unknown) {
      const firstLine = (e instanceof Error ? e.message : String(e)).split("\n")[0];
      log.warn({ email, err: firstLine }, "bluehost.smtp.failed");
      return fail(`SMTP connection failed: ${firstLine}`, 400);
    }

    // ── Step B: Verify IMAP (soft warn) ─────────────────────────────────────
    let imapWarning: string | undefined;
    try {
      const client = new ImapFlow({
        host: imapHost,
        port: imapPort,
        secure: true,
        auth: { user: email, pass: password },
        logger: false,
        connectionTimeout: 10_000,
      });

      await Promise.race([
        (async () => {
          await client.connect();
          await client.logout();
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 10_000),
        ),
      ]);
      log.info({ email }, "bluehost.imap.verified");
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0];
      imapWarning = `IMAP unavailable (${msg}) — reply tracking disabled. SMTP is working.`;
      log.warn({ email, err: msg }, "bluehost.imap.failed");
    }

    // ── Step C: Insert into email_accounts ──────────────────────────────────
    let db;
    try {
      db = getDb();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error({ err: msg }, "bluehost.db.unavailable");
      return fail(`Database unavailable: ${msg}`, 500);
    }

    let row: { id: string; [k: string]: unknown };
    try {
      const result = await db
        .from("email_accounts")
        .insert({
          email,
          from_name: fromName ?? email,
          provider: provider ?? "Bluehost (Titan SMTP)",
          auth_type: "smtp",
          email_provider: "smtp",
          smtp_host: smtpHost,
          smtp_port: smtpPort,
          smtp_user: email,
          smtp_password: password,
          smtp_secure: smtpPort === 465 ? "ssl" : "tls",
          imap_host: imapHost,
          imap_port: imapPort,
          imap_user: email,
          imap_pass: password,
          status: "active",
          is_cold_sender: true,
          warmup_enabled: true,
          warmup_started_at: new Date().toISOString(),
          warmup_target_cap: 50,
          warmup_ramp_days: 21,
        })
        .select()
        .single();

      if (result.error) {
        if ((result.error as { code?: string }).code === "23505") {
          return fail("An account with this email already exists", 409);
        }
        log.error({ email, err: result.error.message }, "bluehost.insert.failed");
        return fail(`DB insert failed: ${result.error.message}`, 500);
      }
      row = result.data;
    } catch (e: unknown) {
      // Network-level failure — supabase-js throws when undici can't reach the host.
      // Unwrap .cause to surface the real reason (ENOTFOUND, ECONNREFUSED, cert error, etc.).
      const err = e as Error & { cause?: unknown };
      const cause = err.cause as { code?: string; message?: string } | undefined;
      const detail =
        cause?.code || cause?.message
          ? `${err.message} (${cause.code ?? ""}${cause.code && cause.message ? ": " : ""}${cause.message ?? ""})`
          : err.message;
      const supabaseUrl = process.env.SUPABASE_URL || "(unset)";
      log.error(
        { email, err: err.message, cause: cause ?? null, supabaseUrl },
        "bluehost.insert.network_failed",
      );
      return fail(`DB unreachable: ${detail} — URL: ${supabaseUrl}`, 500);
    }

    log.info({ email, id: row.id }, "bluehost.account.created");
    return ok({ ...row, ...(imapWarning ? { warning: imapWarning } : {}) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    log.error({ err: msg, stack }, "bluehost.unhandled");
    return fail(`Unhandled: ${msg}`, 500);
  }
}
