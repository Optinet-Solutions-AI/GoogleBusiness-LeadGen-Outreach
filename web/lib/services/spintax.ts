/**
 * spintax.ts — resolve {a|b|c} spintax to one random variant per call.
 *
 * Inputs:  a template string with {opt1|opt2|...} groups (may nest)
 * Outputs: a single resolved string (random pick per group, innermost-first)
 * Used by: lib/pipeline/stage-5-email.ts — so every cold email differs slightly
 *          (identical bodies across recipients is a spam signal).
 *
 * Ported from email-sending-system.md §7.2. Innermost-first resolution handles
 * nesting like "{Hi|{Hey|Howdy} there}". Strips stray braces so malformed
 * templates never leak merge artifacts.
 */

export function resolveSpintax(text: string): string {
  let out = text;
  const innermost = /\{([^{}]+)\}/;
  // Bounded loop — deeply-nested templates resolve well under this.
  for (let i = 0; i < 500; i++) {
    const m = innermost.exec(out);
    if (!m) break;
    const options = m[1].split("|");
    const choice = options[Math.floor(Math.random() * options.length)] ?? "";
    out = out.slice(0, m.index) + choice + out.slice(m.index + m[0].length);
  }
  return out.replace(/[{}]/g, "");
}
