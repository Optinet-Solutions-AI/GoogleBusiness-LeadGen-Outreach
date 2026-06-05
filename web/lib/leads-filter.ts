/**
 * leads-filter.ts — shared "has email / no email" filter for the Leads list.
 *
 * Inputs:  a Supabase leads query builder + an EmailFilter value
 * Outputs: the same builder with the email predicate applied
 * Used by: app/(dashboard)/leads/page.tsx (list) + app/api/leads/ids (select-all)
 *   so the visible rows and "Select all N matching" always agree.
 */

export type EmailFilter = "has" | "missing" | undefined;

/** Coerce a raw query-string value into a known EmailFilter. */
export function parseEmailFilter(v: string | null | undefined): EmailFilter {
  return v === "has" || v === "missing" ? v : undefined;
}

/**
 * Apply the email predicate to a leads query. "has" = a non-empty email;
 * "missing" = no email. Builder types from supabase-js are deeply generic;
 * we treat it loosely and return it (mirrors campaigns/eligibility.ts).
 */
export function applyEmailFilter<Q>(query: Q, email: EmailFilter): Q {
  const q = query as any;
  if (email === "has") return q.not("email", "is", null).neq("email", "");
  if (email === "missing") return q.is("email", null);
  return q;
}
