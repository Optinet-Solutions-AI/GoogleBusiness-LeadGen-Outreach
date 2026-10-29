"use client";

/**
 * VersionHistory.tsx — profile version table with read-only View and Restore.
 *
 * Inputs:  clientId, versions (newest first), currentVersion
 * Outputs: GET .../brain/versions/:v (view), POST .../restore, toast, router.refresh()
 * Used by: app/(dashboard)/clients/[id]/page.tsx (History tab)
 */

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { relativeTime } from "@/lib/format";

export type VersionItem = {
  version: number;
  written_by: string;
  state: string;
  note: string | null;
  created_at: string;
};

export function VersionHistory({
  clientId,
  versions,
  currentVersion,
}: {
  clientId: string;
  versions: VersionItem[];
  currentVersion: number | null;
}) {
  const router = useRouter();
  const [openV, setOpenV] = useState<number | null>(null);
  const [data, setData] = useState<Record<number, Record<string, unknown>>>({});
  const [busy, setBusy] = useState<number | null>(null);

  async function view(v: number) {
    if (openV === v) return setOpenV(null);
    if (!data[v]) {
      setBusy(v);
      const res = await fetchJson<{ data: Record<string, unknown> }>(`/api/clients/${clientId}/brain/versions/${v}`);
      setBusy(null);
      if (!res.success) return void toast.error(res.error);
      setData((p) => ({ ...p, [v]: res.data.data }));
    }
    setOpenV(v);
  }

  async function restore(v: number) {
    if (!confirm(`Restore version ${v}? This creates a new version with its contents.`)) return;
    setBusy(v);
    const res = await fetchJson<{ version: number }>(`/api/clients/${clientId}/brain/versions/${v}/restore`, {
      method: "POST",
    });
    setBusy(null);
    if (!res.success) return void toast.error(res.error);
    toast.success(`Restored as version ${res.data.version}.`);
    router.refresh();
  }

  if (versions.length === 0) {
    return (
      <div className="bg-surface border border-rule rounded-lg p-10 text-center">
        <p className="text-[13px] text-ink-muted">No profile versions yet. Build the Brand Brain from the Overview tab.</p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-rule rounded-lg overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-ink-subtle border-b border-rule">
            <th className="px-4 py-2.5">Version</th>
            <th className="px-4 py-2.5">By</th>
            <th className="px-4 py-2.5">State</th>
            <th className="px-4 py-2.5">Note</th>
            <th className="px-4 py-2.5">When</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <Fragment key={v.version}>
              <tr className="border-b border-rule last:border-0">
                <td className="px-4 py-2.5 mono-num font-semibold">v{v.version}</td>
                <td className="px-4 py-2.5 capitalize">{v.written_by}</td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex px-2 py-0.5 rounded text-[10.5px] border border-rule bg-surface-alt">
                    {v.state.replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink-muted max-w-[320px] truncate" title={v.note ?? ""}>
                  {v.note ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">{relativeTime(v.created_at)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-right space-x-2">
                  <Button size="sm" variant="secondary" onClick={() => view(v.version)} loading={busy === v.version}>
                    {openV === v.version ? "Hide" : "View"}
                  </Button>
                  {v.version !== currentVersion && (
                    <Button size="sm" variant="secondary" onClick={() => restore(v.version)} disabled={busy !== null}>
                      Restore
                    </Button>
                  )}
                </td>
              </tr>
              {openV === v.version && data[v.version] && (
                <tr className="border-b border-rule bg-surface-alt">
                  <td colSpan={6} className="px-4 py-3">
                    <div className="space-y-3">
                      {Object.entries(data[v.version]).map(([k, val]) => (
                        <div key={k}>
                          <p className="eyebrow text-ink-subtle mb-1">{k}</p>
                          <pre className="text-[11.5px] text-ink whitespace-pre-wrap break-words max-h-64 overflow-auto">
                            {JSON.stringify(val, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
