/**
 * email/plain-text.ts — plain text the operator typed → the simple HTML we send. Pure (client-safe).
 *
 * Inputs:  plain text
 * Outputs: escaped HTML: a blank line starts a new paragraph, a single newline becomes <br>
 * Used by: lib/email/send-simple.ts (the send) and components/outreach/SimpleEmailModal.tsx (spam check)
 */
export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${p.trim().replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}
