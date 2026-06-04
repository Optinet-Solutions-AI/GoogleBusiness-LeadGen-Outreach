/**
 * cx.ts — tiny className joiner (no dependency, client-safe).
 *
 * Inputs:  any number of class strings; falsy parts (false/null/undefined) drop out.
 * Outputs: a single space-joined className string.
 * Used by: components/ui/* primitives and any component composing conditional classes.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
