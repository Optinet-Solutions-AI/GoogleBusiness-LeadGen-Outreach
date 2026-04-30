/**
 * format.ts — Tiny formatting helpers shared across template components.
 */

export function telHref(phone: string | null | undefined): string {
  if (!phone) return "#";
  return `tel:${phone.replace(/[^0-9+]/g, "")}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function cityFromAddress(address: string | null | undefined): string {
  if (!address) return "";
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2].split(" ")[0] : "";
}
