"use client";

/**
 * BrainEditor.tsx — grouped, sourced editor for the current Brand Brain profile (spec §6.3).
 *
 * Inputs:  clientId, clientVersion (clients.current_version), current profile or null, assets (logo lookup)
 * Outputs: PUT /api/clients/:id/brain { data, expected_version }, toast, router.refresh()
 * Used by: app/(dashboard)/clients/[id]/page.tsx (Brain tab)
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { FactField } from "@/components/clients/FactField";
import { confirmGroup, confirmPath, getPath, PROFILE_GROUPS, setPath } from "@/lib/clients/profile-paths";
import { EMPTY_PROFILE, type BrandProfileData } from "@/lib/clients/types";
import type { AssetRow } from "@/lib/clients/assets";

type Current = { version: number; data: BrandProfileData } | null;

export function BrainEditor({
  clientId,
  clientVersion,
  current,
  assets,
}: {
  clientId: string;
  clientVersion: number;
  current: Current;
  assets: Pick<AssetRow, "id" | "public_url" | "alt">[];
}) {
  const router = useRouter();
  const initial = current?.data ?? EMPTY_PROFILE;
  const [data, setData] = useState<BrandProfileData>(initial);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(data) !== JSON.stringify(initial);
  const logo = assets.find((a) => a.id === data.visuals.logo_asset_id);

  async function save() {
    setSaving(true);
    const res = await fetchJson(`/api/clients/${clientId}/brain`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data, expected_version: clientVersion }),
    });
    setSaving(false);
    if (!res.success) {
      toast.error(res.error);
      router.refresh();
      return;
    }
    toast.success("Brand Brain saved.");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] text-ink-muted">
          {current ? `Current profile v${current.version}.` : "No profile yet — fill it in by hand or build one from the sources."}{" "}
          Editing a field marks it operator-confirmed.
        </p>
        <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!dirty || saving}>
          Save
        </Button>
      </div>

      {PROFILE_GROUPS.map((g) => (
        <section key={g.key} className="bg-surface border border-rule rounded-lg p-5" data-group={g.key}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[13px] font-semibold text-ink">{g.label}</h3>
            <button
              type="button"
              className="text-[11.5px] text-ink-muted hover:text-ink underline decoration-dotted"
              onClick={() => setData((d) => confirmGroup(d, g.key))}
            >
              Confirm all
            </button>
          </div>
          {g.key === "visuals" && (
            <div className="flex items-center gap-3 py-2 border-b border-rule">
              <span className="text-[12px] font-medium text-ink">Logo</span>
              {logo?.public_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo.public_url} alt={logo.alt ?? "logo"} className="h-10 w-10 object-contain rounded border border-rule bg-surface-alt" />
              ) : (
                <span className="text-[12px] text-ink-subtle">none</span>
              )}
              <span className="text-[11px] text-ink-subtle">Set in the Assets tab.</span>
            </div>
          )}
          {g.fields.map((f) => (
            <FactField
              key={f.path}
              path={f.path}
              label={f.label}
              kind={f.kind}
              fact={getPath(data, f.path)}
              onChange={(v) => setData((d) => setPath(d, f.path, v))}
              onConfirm={() => setData((d) => confirmPath(d, f.path))}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
