/**
 * smtp-probe.ts — stage 4: HELO → MAIL FROM → RCPT TO → QUIT (never DATA).
 * Port 25 is blocked on Vercel/Cloud Run, so this no-ops to unknown there; it
 * only resolves valid/invalid on a host with port 25 open (local backfill).
 *
 * Inputs:  email address, MX hostname, opts.enabled flag
 * Outputs: StageResult + raw diagnostic string
 * Used by: catch-all-probe.ts, orchestrator (email-validator)
 */
import net from "node:net";
import { env } from "../../config";
import type { StageResult } from "./types";

const TIMEOUT_MS = 7000;

export async function smtpProbe(
  email: string,
  mxHost: string,
  opts: { enabled?: boolean } = {},
): Promise<StageResult & { raw: string }> {
  if (opts.enabled === false) return { status: "unknown", decisive: false, raw: "disabled" };
  return new Promise((resolve) => {
    const socket = net.createConnection(25, mxHost);
    let step = 0;
    const done = (status: StageResult["status"], decisive: boolean, raw: string) => {
      try { socket.write("QUIT\r\n"); socket.end(); } catch { /* noop */ }
      resolve({ status, decisive, raw });
    };
    socket.setTimeout(TIMEOUT_MS, () => done("unknown", false, "timeout"));
    socket.on("error", () => done("unknown", false, "error"));
    socket.on("data", (buf) => {
      const line = buf.toString();
      const code = parseInt(line.slice(0, 3), 10);
      if (step === 0) { socket.write(`HELO ${env.SMTP_PROBE_HELO}\r\n`); step = 1; return; }
      if (step === 1) { socket.write(`MAIL FROM:<${env.SMTP_PROBE_FROM}>\r\n`); step = 2; return; }
      if (step === 2) { socket.write(`RCPT TO:<${email}>\r\n`); step = 3; return; }
      if (step === 3) {
        if (code === 250 || code === 251) return done("valid", true, `rcpt_${code}`);
        if (code >= 500) return done("invalid", true, `rcpt_${code}`);
        return done("unknown", false, `rcpt_${code}`);
      }
    });
  });
}
