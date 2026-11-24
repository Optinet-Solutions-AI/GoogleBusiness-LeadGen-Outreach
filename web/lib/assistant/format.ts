/**
 * assistant/format.ts — turn the assistant's small-markdown answer into blocks the panel renders. Pure.
 *
 * Inputs:  answer text (paragraphs, "1." / "-" lists, **bold**, `code`, [label](/app-path))
 * Outputs: Block[] — no HTML strings, so nothing in an answer can inject markup
 * Used by: components/assistant/AssistantWidget.tsx
 *
 * Only in-app links survive (paths starting with a single "/"); any other link is shown as its plain label.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; v: string }
  | { t: "code"; v: string }
  | { t: "link"; v: string; href: string };

export type Block = { kind: "p" | "ol" | "ul"; items: Inline[][] };

/** Is this a safe in-app path? "/leads" yes; "//evil.com", "https://…", "javascript:" no. */
export function isAppPath(href: string): boolean {
  return /^\/(?!\/)[A-Za-z0-9\-._~/?#=&%]*$/.test(href);
}

/** A bare app path the model wrote without its slash ("batches") gets one; anything with a dot or colon doesn't. */
export function fixAppPath(href: string): string {
  return /^[A-Za-z][A-Za-z0-9\-_/]*$/.test(href) ? `/${href}` : href;
}

// A bold link (**[Batches](/batches)**) first, so it renders as a link instead of raw markdown in bold.
const INLINE = /\*\*\[([^\]]+)\]\(([^)\s]+)\)\*\*|\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of line.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: "text", v: line.slice(last, i) });
    const label = m[1] ?? m[5];
    if (label !== undefined) {
      const href = fixAppPath(m[2] ?? m[6] ?? "");
      out.push(isAppPath(href) ? { t: "link", v: label, href } : { t: "text", v: label });
    } else if (m[3] !== undefined) out.push({ t: "b", v: m[3] });
    else if (m[4] !== undefined) out.push({ t: "code", v: m[4] });
    last = i + m[0].length;
  }
  if (last < line.length) out.push({ t: "text", v: line.slice(last) });
  return out;
}

export function parseAnswerBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      blocks.push({ kind: "p", items: [] }); // paragraph break marker, dropped below
      continue;
    }
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    const ul = /^[-*•]\s+(.*)$/.exec(line);
    const kind: Block["kind"] = ol ? "ol" : ul ? "ul" : "p";
    const body = (ol?.[1] ?? ul?.[1] ?? line).replace(/^#{1,6}\s+(.*)$/, "**$1**");
    const prev = blocks[blocks.length - 1];
    if (prev && prev.kind === kind && kind !== "p" && prev.items.length) prev.items.push(parseInline(body));
    else if (prev && prev.kind === "p" && kind === "p" && prev.items.length) prev.items.push(parseInline(body));
    else blocks.push({ kind, items: [parseInline(body)] });
  }
  return blocks.filter((b) => b.items.length > 0);
}
