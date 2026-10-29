/**
 * html-to-text.ts — Convert a web page's HTML into readable, prompt-ready text.
 *
 * Inputs:  raw HTML (up to ~2 MB)
 * Outputs: { title, text } — chrome removed, headings/paragraphs/list items kept, <= 200k chars
 * Used by: the Brand Brain website crawler and Gemini prompt builder
 *
 * Regex/indexOf based (no dependency) and linear: every pattern is bounded by
 * `[^<>]` so unclosed or hostile markup cannot cause catastrophic backtracking.
 * Prices ($49, EUR/GBP/USD amounts) survive because all body text is kept.
 */

const MAX_CHARS = 200_000;
const DROP_BLOCKS = ["script", "style", "noscript", "svg", "nav", "footer", "header"];
const LINE_BREAK_TAGS =
  "p|div|section|article|main|aside|br|tr|table|ul|ol|dl|dt|dd|blockquote|pre|form|figure|figcaption|hr";

function codePoint(n: number, fallback: string): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return fallback;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ").replace(/&#160;/g, " ")
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&euro;/gi, "€").replace(/&pound;/gi, "£").replace(/&ndash;/gi, "-").replace(/&mdash;/gi, "-")
    .replace(/&#x([0-9a-f]+);/gi, (m, h: string) => codePoint(parseInt(h, 16), m))
    .replace(/&#(\d+);/g, (m, d: string) => codePoint(parseInt(d, 10), m))
    .replace(/&amp;/gi, "&");
}

/** Remove `<name ...> ... </name>` blocks using indexOf (linear). An unclosed
 *  opener is dropped on its own so the rest of the page is still readable. */
function dropBlock(html: string, name: string): string {
  const lower = html.toLowerCase();
  const open = `<${name}`;
  const close = `</${name}`;
  let out = "";
  let pos = 0;
  let noClose = false;
  for (;;) {
    let i = lower.indexOf(open, pos);
    // Opener must be followed by a tag boundary (so <nav does not match <navigation>).
    while (i !== -1 && !/[\s>/]/.test(lower.charAt(i + open.length))) i = lower.indexOf(open, i + 1);
    if (i === -1) break;
    out += html.slice(pos, i);
    const c = noClose ? -1 : lower.indexOf(close, i + open.length);
    if (c === -1) noClose = true; // no closer after here means none later either (keeps this linear)
    const openEnd = lower.indexOf(">", i);
    if (c === -1) {
      pos = openEnd === -1 ? html.length : openEnd + 1;
      continue;
    }
    const closeEnd = lower.indexOf(">", c);
    pos = closeEnd === -1 ? html.length : closeEnd + 1;
  }
  return out + html.slice(pos);
}

export function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = html.match(/<title\b[^<>]*>([^<]*)<\/title\s*>/i);
  const titleRaw = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : "";
  const title = titleRaw || null;

  let s = html.replace(/<!--[\s\S]*?-->/g, " ");
  s = dropBlock(s, "head");
  for (const name of DROP_BLOCKS) s = dropBlock(s, name);

  s = s
    .replace(/<h[1-6]\b[^<>]*>/gi, "\n")
    .replace(/<\/h[1-6]\s*>/gi, "\n")
    .replace(/<li\b[^<>]*>/gi, "\n- ")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<\/?t[dh]\b[^<>]*>/gi, " ")
    .replace(new RegExp(`</?(?:${LINE_BREAK_TAGS})\\b[^<>]*>`, "gi"), "\n")
    .replace(/<\/?[a-zA-Z][^<>]*>/g, " ");

  const lines: string[] = [];
  for (const raw of decodeEntities(s).split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line && line !== "-") lines.push(line);
  }
  let text = lines.join("\n");
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
  return { title, text };
}
