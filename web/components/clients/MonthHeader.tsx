"use client";

/**
 * MonthHeader.tsx — month picker, plan status + progress, estimated cost, Plan / Download / Make-a-post actions.
 *
 * Inputs:  clientId, month (YYYY-MM), plan, creatives, imageUsd, products, onMakePost
 * Outputs: navigation via ?month=; the month pack zipped in the browser from /api/clients/:id/pack?format=manifest
 * Used by: PostsTab
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import JSZip from "jszip";
import { Download, Plus } from "lucide-react";
import { toast } from "@/components/ui/toast-store";
import type { PackManifest } from "@/lib/creatives/pack";
import { Button } from "@/components/ui/Button";
import { creativeUnitUsd } from "@/lib/creatives/cost";
import { TEMPLATES } from "@/lib/creatives/templates/registry";
import type { CreativeListRow } from "@/lib/creatives/creatives";
import type { PlanRow } from "@/lib/creatives/plans";
import type { ProductSnapshot } from "@/lib/clients/types";
import { PlanMonthWizard } from "@/components/clients/PlanMonthWizard";

/** Fetch the manifest + every PNG (<= 6 in flight), zip in the browser, save via a Blob URL. */
async function downloadPack(clientId: string, month: string, onProgress: (label: string) => void): Promise<void> {
  const res = await fetch(`/api/clients/${clientId}/pack?month=${month}&format=manifest`);
  const json = (await res.json()) as { success: boolean; data?: PackManifest; error?: string };
  if (!json.success || !json.data) throw new Error(json.error ?? "could not load the pack");
  const m = json.data;
  const zip = new JSZip();
  let done = 0;
  let next = 0;
  onProgress(`Packing 0/${m.files.length}…`);
  const worker = async () => {
    while (next < m.files.length) {
      const f = m.files[next++];
      const r = await fetch(f.url);
      if (!r.ok) throw new Error(`could not download ${f.name} (${r.status})`);
      zip.file(f.name, await r.blob());
      onProgress(`Packing ${++done}/${m.files.length}…`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, m.files.length) }, worker));
  zip.file("captions.csv", m.captions_csv);
  onProgress("Zipping…");
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = m.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function MonthHeader({
  clientId,
  month,
  plan,
  creatives,
  imageUsd,
  products,
  onMakePost,
}: {
  clientId: string;
  month: string;
  plan: PlanRow | null;
  creatives: CreativeListRow[];
  imageUsd: number;
  products: ProductSnapshot[];
  onMakePost: () => void;
}) {
  const router = useRouter();
  const [wizard, setWizard] = useState(false);
  const [packing, setPacking] = useState<string | null>(null);
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
        <Button variant="secondary" size="sm" onClick={() => setWizard(true)}>
          Plan a month
        </Button>
        {approved > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={packing !== null}
            onClick={() => {
              setPacking("Packing…");
              downloadPack(clientId, month, setPacking)
                .catch((e) => toast.error(e instanceof Error ? e.message : "Download failed"))
                .finally(() => setPacking(null));
            }}
          >
            <Download size={13} aria-hidden /> {packing ?? "Download pack"}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" disabled title="Approve at least one post first">
            <Download size={13} aria-hidden /> Download pack
          </Button>
        )}
        <Button size="sm" onClick={onMakePost}>
          <Plus size={13} aria-hidden /> Make a post
        </Button>
      </div>
      {wizard && (
        <PlanMonthWizard
          clientId={clientId}
          month={month}
          plan={plan}
          products={products}
          onClose={() => setWizard(false)}
        />
      )}
    </div>
  );
}
