/**
 * analytics/CostPerReply.tsx — the "Cost per reply" table: per niche, city or offer, what we spent and what a reply
 * cost (27 Nov 2026).
 *
 * Inputs:  rows (lib/analytics/cost-per-reply-load.ts), the current grouping and range (from the URL)
 * Outputs: the table + Group by / range links (?cpr=niche|city|offer&cprdays=30|90|all; the page's other params kept)
 * Used by: app/(dashboard)/analytics/page.tsx
 *
 * Dumb. workflows/read_cost_per_reply.md.
 */
import Link from "next/link";
import { cx } from "@/lib/cx";
import type { CprRow, GroupBy } from "@/lib/analytics/cost-per-reply";

const GROUPS: { key: GroupBy; label: string }[] = [
  { key: "niche", label: "Niche" },
  { key: "city", label: "City" },
  { key: "offer", label: "Offer" },
];
const RANGES: { key: string; label: string }[] = [
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "all", label: "All" },
];

const money = (n: number | null) => (n === null ? "—" : `$${n.toFixed(2)}`);
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 1000) / 10}%`);

function Pill({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={cx("rounded px-2 py-1 text-[12px] font-medium", on ? "bg-action text-white" : "text-ink-muted hover:text-ink hover:bg-surface-alt")}
    >
      {children}
    </Link>
  );
}

export function CostPerReply({ rows, groupBy, days, params }: { rows: CprRow[]; groupBy: GroupBy; days: string; params: Record<string, string | undefined> }) {
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, cpr: groupBy, cprdays: days, ...over })) if (v) q.set(k, v);
    return `/analytics?${q.toString()}`;
  };
  const label = GROUPS.find((g) => g.key === groupBy)?.label ?? "Niche";
  return (
    <section className="bg-surface border border-rule rounded-lg p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow">Cost per reply · where to scale</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-ink-subtle mr-1">Group by</span>
            {GROUPS.map((g) => (
              <Pill key={g.key} href={href({ cpr: g.key })} on={g.key === groupBy}>
                {g.label}
              </Pill>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {RANGES.map((r) => (
              <Pill key={r.key} href={href({ cprdays: r.key })} on={r.key === days}>
                {r.label}
              </Pill>
            ))}
          </div>
        </div>
      </div>
      <p className="text-[12px] text-ink-muted leading-relaxed">
        Spend is estimated: each batch&apos;s estimate shared over its leads, plus contact form costs. AI call minutes and
        email sending aren&apos;t included. Anything done while Test mode was on is left out, so this stays mostly empty
        until the app goes live. Dates are when the batch was made.
      </p>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-rule">
              <tr>
                <th className="py-2 pr-3">{label}</th>
                <th className="py-2 px-2 text-right">Leads found</th>
                <th className="py-2 px-2 text-right">Contacted</th>
                <th className="py-2 px-2 text-right">Emails sent</th>
                <th className="py-2 px-2 text-right">Replies</th>
                <th className="py-2 px-2 text-right">Reply rate</th>
                <th className="py-2 px-2 text-right">Interested calls</th>
                <th className="py-2 px-2 text-right">Spend (estimated)</th>
                <th className="py-2 pl-2 text-right">Cost per reply</th>
              </tr>
            </thead>
            <tbody className="mono-num">
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-rule last:border-0">
                  <td className="py-2 pr-3 font-sans font-semibold text-ink">{r.key}</td>
                  <td className="py-2 px-2 text-right">{r.found}</td>
                  <td className="py-2 px-2 text-right">{r.contacted}</td>
                  <td className="py-2 px-2 text-right">{r.emails}</td>
                  <td className="py-2 px-2 text-right">{r.replies}</td>
                  <td className="py-2 px-2 text-right">{pct(r.rate)}</td>
                  <td className="py-2 px-2 text-right">{r.interested_calls}</td>
                  <td className="py-2 px-2 text-right">{money(r.spend)}</td>
                  <td className="py-2 pl-2 text-right font-bold text-ink">{money(r.cost_per_reply)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[13px] text-ink-muted">No batches in this range yet.</p>
      )}
    </section>
  );
}
