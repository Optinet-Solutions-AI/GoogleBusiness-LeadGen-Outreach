/**
 * email-body.ts — Body helpers shared by the email senders (plain-text part, screenshot placement).
 *
 * Inputs:  outreach email HTML, an <img> tag
 * Outputs: Message-ID; plain-text alternative; HTML with the image at the <!--SCREENSHOT--> marker
 * Used by: lib/services/smtp-sender.ts, lib/services/ongage.ts
 */

/** Domain-aligned Message-ID for an outbound email from `fromEmail`. */
export function newMessageId(fromEmail: string): string {
  const host = fromEmail.split("@")[1] || "localhost";
  return `<${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}@${host}>`;
}

/** Plain-text alternative of an HTML body — HTML-only mail is a spam signal. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Place the screenshot where the body asks (<!--SCREENSHOT-->), so copy can sit
 * below it; otherwise append it at the end (legacy behavior).
 */
export function placeScreenshot(html: string, img: string): string {
  return html.includes("<!--SCREENSHOT-->") ? html.replace("<!--SCREENSHOT-->", img) : `${html}<br>${img}`;
}
