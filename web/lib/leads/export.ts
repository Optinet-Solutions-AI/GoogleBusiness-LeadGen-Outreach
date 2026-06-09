/**
 * leads/export.ts — build a CSV from lead rows for hand-off to external tools
 * (e.g. the standalone voice-agent app). Pure + unit-tested; the route filters.
 *
 * Inputs:  lead rows (DB shape)
 * Outputs: an RFC-4180 CSV string (CRLF line endings, quoted where needed)
 * Used by: app/api/batches/[id]/export/route.ts
 */

export interface ExportLead {
  business_name: string | null;
  phone: string | null;
  category: string | null;
  address: string | null;
  country_code: string | null;
  website_url: string | null;
  has_website: boolean | null;
  email: string | null;
  verification_status: string | null;
  rating: number | null;
  review_count: number | null;
  stage: string | null;
}

/** Column order = CSV header order. business_name + phone first (what a dialer needs). */
const COLUMNS: { header: string; get: (l: ExportLead) => unknown }[] = [
  { header: "business_name", get: (l) => l.business_name },
  { header: "phone", get: (l) => l.phone },
  { header: "category", get: (l) => l.category },
  { header: "address", get: (l) => l.address },
  { header: "country_code", get: (l) => l.country_code },
  { header: "website_url", get: (l) => l.website_url },
  { header: "has_website", get: (l) => l.has_website },
  { header: "email", get: (l) => l.email },
  { header: "verification_status", get: (l) => l.verification_status },
  { header: "rating", get: (l) => l.rating },
  { header: "review_count", get: (l) => l.review_count },
  { header: "stage", get: (l) => l.stage },
];

/** RFC-4180 escape: quote if the cell holds a comma/quote/newline; double inner quotes. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function leadsToCsv(rows: ExportLead[]): string {
  const head = COLUMNS.map((c) => c.header).join(",");
  if (rows.length === 0) return `${head}\r\n`;
  const body = rows.map((r) => COLUMNS.map((c) => csvCell(c.get(r))).join(",")).join("\r\n");
  return `${head}\r\n${body}\r\n`;
}
