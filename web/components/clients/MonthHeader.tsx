"use client";

/**
 * MonthHeader.tsx — month picker, plan status + progress, estimated cost, Plan / Download / Make-a-post actions.
 *
 * Inputs:  clientId, month (YYYY-MM), plan, creatives, imageUsd, onMakePost
 * Outputs: navigation via ?month=; link to /api/clients/:id/pack?month=
 * Used by: PostsTab
 */

import { useRouter } from "next/navigation";
import { Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { creativeUnitUsd } from "@/lib/creatives/cost";
import { TEMPLATES } from "@/lib/creatives/templates/registry";
import type { CreativeListRow } from "@/lib/creatives/creatives";
import type { PlanRow } from "@/lib/creatives/plans";

export function MonthHeader({
  clientId,
  month,
  plan,
  creatives,
  imageUsd,
  onMakePost,
}: {
  clientId: string;
  month: string;
  plan: PlanRow | null;
  creatives: CreativeListRow[];
  imageUsd: number;
  onMakePost: () => void;
}) {
  const router = useRouter();
  const total = creatives.length;
  const ready = creatives.filter((c) => c.latest && c.latest.renders.length > 0).length;
  const approved = creatives.filter((c) => c.latest?.state === "approved").length;
  const cost = creatives.reduce(
    (s, c) => s + creativeUnitUsd({ background: TEMPLATES[c.template_key].defaultBackground }, imageUsd),
    0,
  );

  return (
    <div className="bg-surface border border-rule rounded-lg px-5 py-3 flex flex-wrap items-center gap-x-5 gap-y-3">
      <label className="flex items-center gap-2 text-[12px] text-ink-muted">
        Month
        <input
          type="month"
          value={month}
          onChange={(e) => e.target.value && router.push(`?tab=posts&month=${e.target.value}`)}
          className="border border-rule rounded px-2 py-1 text-[12.5px] text-ink bg-surface"
        />
      </label>
      <span className="inline-flex px-2 py-0.5 rounded text-[10.5px] font-medium border border-rule bg-surface-alt capitalize text-ink-muted">
        {plan ? `Plan ${plan.status}` : "No plan"}
      </span>
      <span className="text-[12px] text-ink-muted">
        {ready}/{total} ready · {approved} approved
      </span>
      <span className="text-[12px] text-ink-muted" title="Estimate from template and image price; not a bill">
        Est. cost ${cost.toFixed(2)}
      </span>
      <div className="flex items-center gap-2 ml-auto">
        <Button variant="secondary" size="sm" disabled title="Coming soon">
          Plan a month
        </Button>
        {approved > 0 ? (
          <a href={`/api/clients/${clientId}/pack?month=${month}`} className="btn btn-secondary btn-sm">
            <Download size={13} aria-hidden /> Download pack
          </a>
        ) : (
          <Button variant="secondary" size="sm" disabled title="Approve at least one post first">
            <Download size={13} aria-hidden /> Download pack
          </Button>
        )}
        <Button size="sm" onClick={onMakePost}>
          <Plus size={13} aria-hidden /> Make a post
        </Button>
      </div>
    </div>
  );
}
