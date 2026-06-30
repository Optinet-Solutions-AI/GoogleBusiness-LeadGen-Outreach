/**
 * (dashboard)/revenue/page.tsx — revenue rollup from per-lead billing records.
 *
 * Inputs:  leads with billing fields (setup_fee, monthly_amount, billing_status)
 * Outputs: MRR / ARR / paying customers / setup collected / awaiting / past-due
 *          stat strip + a table of every billed lead.
 * Used by: SideNav → /revenue
 *
 * Record-only billing (no live charging). "Active" = paying monthly → counts
 * toward MRR; "invoiced" = setup sent, awaiting payment.
 */

import Link from "next/link";
import { Wallet } from "lucide-react";
import { isDbConfigured, safeDb } from "@/lib/safe-db";
import { StatCard } from "@/components/StatCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { usd } from "@/lib/format";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

interface BilledLead {
  id: string;
  business_name: string;
  custom_domain: string | null;
  setup_fee: number | null;
  monthly_amount: number | null;
  billing_status: string | null;
  billing_updated_at: string | null;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-positive-soft text-positive border-positive/30" },
  invoiced: { label: "Invoiced", cls: "bg-action-soft text-action border-action/30" },
  past_due: { label: "Past due", cls: "bg-warning-soft text-warning border-warning/30" },
  canceled: { label: "Canceled", cls: "bg-surface-alt text-ink-subtle border-rule" },
};

async function getBilledLeads(): Promise<BilledLead[]> {
  if (!isDbConfigured()) return [];
  return safeDb(async (db) => {
    const { data } = await db
      .from("leads")
      .select("id,business_name,custom_domain,setup_fee,monthly_amount,billing_status,billing_updated_at")
      .not("billing_status", "is", null)
      .order("billing_updated_at", { ascending: false })
      .limit(2000);
    return (data ?? []) as BilledLead[];
  }, []);
}

const STATUS_ORDER: Record<string, number> = { active: 0, invoiced: 1, past_due: 2, canceled: 3 };

export default async function RevenuePage() {
  const leads = await getBilledLeads();

  const active = leads.filter((l) => l.billing_status === "active");
  const invoiced = leads.filter((l) => l.billing_status === "invoiced");
  const pastDue = leads.filter((l) => l.billing_status === "past_due");

  const sum = (rows: BilledLead[], k: "setup_fee" | "monthly_amount") =>
    rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);

  const mrr = sum(active, "monthly_amount");
  const arr = mrr * 12;
  const setupCollected = sum(active, "setup_fee");
  const awaiting = sum(invoiced, "setup_fee") + sum(invoiced, "monthly_amount");

  const sorted = [...leads].sort((a, b) => {
    const o = (STATUS_ORDER[a.billing_status ?? ""] ?? 9) - (STATUS_ORDER[b.billing_status ?? ""] ?? 9);
    if (o !== 0) return o;
    return (Number(b.monthly_amount) || 0) - (Number(a.monthly_amount) || 0);
  });

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Revenue"
        subtitle={
          <>
            <span className="mono-num text-ink font-semibold">{usd(mrr, 0)}</span> MRR ·{" "}
            <span className="mono-num text-ink font-semibold">{active.length}</span>{" "}
            paying {active.length === 1 ? "customer" : "customers"}
          </>
        }
      />

      {leads.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No billing recorded yet"
          description="When you close a deal, open the lead and record the setup fee + monthly hosting in its Billing card. Totals show here."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard label="MRR" value={usd(mrr, 0)} emphasis hint="active monthly" />
            <StatCard label="ARR (run-rate)" value={usd(arr, 0)} hint="MRR × 12" />
            <StatCard label="Paying customers" value={active.length} hintTone="positive" hint={active.length ? "active" : undefined} />
            <StatCard label="Setup collected" value={usd(setupCollected, 0)} hint="from active deals" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard label="Awaiting payment" value={usd(awaiting, 0)} hint={`${invoiced.length} invoiced`} />
            <StatCard label="Past due" value={pastDue.length} hintTone={pastDue.length ? "warning" : "neutral"} hint={pastDue.length ? usd(sum(pastDue, "monthly_amount"), 0) + "/mo at risk" : undefined} />
          </div>

          <div className="bg-surface border border-rule rounded-lg overflow-auto max-h-[calc(100vh-22rem)]">
            <table className="w-full min-w-[640px] text-left border-collapse">
              <thead className="sticky top-0 z-20 bg-surface-alt">
                <tr className="border-b border-rule">
                  <Th>Customer</Th>
                  <Th className="text-right">Setup</Th>
                  <Th className="text-right">Monthly</Th>
                  <Th>Status</Th>
                  <Th>Updated</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {sorted.map((l) => {
                  const meta = STATUS_META[l.billing_status ?? ""] ?? { label: l.billing_status ?? "—", cls: "bg-surface-alt text-ink-muted border-rule" };
                  return (
                    <tr key={l.id} className="hover:bg-surface-alt transition-colors">
                      <td className="px-4 py-2.5">
                        <Link href={`/leads/${l.id}`} className="text-[14px] font-semibold text-ink hover:text-action">
                          {l.business_name}
                        </Link>
                        {l.custom_domain && <div className="text-[11px] text-ink-subtle mono-num">{l.custom_domain}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right mono-num text-[13px] text-ink-muted">{l.setup_fee != null ? usd(l.setup_fee, 0) : "—"}</td>
                      <td className="px-4 py-2.5 text-right mono-num text-[13px] text-ink">{l.monthly_amount != null ? `${usd(l.monthly_amount, 0)}/mo` : "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10.5px] font-semibold border ${meta.cls}`}>{meta.label}</span>
                      </td>
                      <td className="px-4 py-2.5 mono-num text-[11px] text-ink-subtle">{relativeTime(l.billing_updated_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Th({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return <th className={`px-4 py-3 text-label-caps text-ink-muted uppercase tracking-[0.18em] whitespace-nowrap ${className}`}>{children}</th>;
}
