"use client";

/**
 * ClientOverview.tsx — sources list, Build Brand Brain button (with polling) and the last job.
 *
 * Inputs:  client, sources, lastJob (serializable rows), hasProfile
 * Outputs: POST/DELETE .../sources, POST .../brain/build, GET /api/clients/:id (poll), router.refresh()
 * Used by: app/(dashboard)/clients/[id]/page.tsx (Overview tab)
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { relativeTime } from "@/lib/format";
import { cx } from "@/lib/cx";

/** A build older than this is treated as dead (matches LeadActions). */
const BRAIN_STALE_MS = 20 * 60 * 1000;
const POLL_MS = 5000;

type SourceItem = {
  id: string;
  kind: string;
  url: string | null;
  status: "new" | "crawled" | "partial" | "blocked" | "failed";
  page_count: number | null;
  last_crawled_at: string | null;
  last_error: string | null;
};

type JobItem = {
  status: "running" | "done" | "failed";
  started_at: string;
  finished_at: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  error: string | null;
  output: { facts_kept?: number; facts_dropped?: number } | null;
};

type ClientItem = { id: string; brain_started_at: string | null };

const SOURCE_STATUS_TONE: Record<string, string> = {
  new: "text-ink-muted",
  crawled: "text-positive",
  partial: "text-warning",
  blocked: "text-warning",
  failed: "text-danger",
};
const JOB_TONE: Record<string, string> = {
  running: "text-warning",
  done: "text-positive",
  failed: "text-danger",
};
const ADDABLE = ["website", "demo_site", "facebook", "instagram"];

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={cx("inline-flex px-2 py-0.5 rounded text-[10.5px] font-medium border border-rule bg-surface-alt", tone)}>
      {children}
    </span>
  );
}

function isFresh(startedAt: string | null): boolean {
  if (!startedAt) return false;
  const ms = new Date(startedAt).getTime();
  return !Number.isNaN(ms) && Date.now() - ms <= BRAIN_STALE_MS;
}

function duration(job: JobItem): string | null {
  if (!job.finished_at) return null;
  const s = Math.max(0, Math.round((new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export function ClientOverview({
  client,
  sources,
  lastJob,
  hasProfile,
}: {
  client: ClientItem;
  sources: SourceItem[];
  lastJob: JobItem | null;
  hasProfile: boolean;
}) {
  const router = useRouter();
  const [building, setBuilding] = useState(isFresh(client.brain_started_at));
  const [kind, setKind] = useState("website");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const cancelled = useRef(false);
  const pollId = useRef(0);

  // Poll until the server clears brain_started_at (it owns the flag; we never clear it).
  async function pollUntilDone() {
    pollId.current += 1;
    const mine = pollId.current;
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (cancelled.current || pollId.current !== mine) return;
      const res = await fetchJson<{ brain_started_at: string | null }>(`/api/clients/${client.id}`);
      if (!res.success) continue;
      if (!res.data.brain_started_at) break;
    }
    if (cancelled.current || pollId.current !== mine) return;
    setBuilding(false);
    router.refresh();
  }

  useEffect(() => {
    cancelled.current = false;
    if (isFresh(client.brain_started_at)) void pollUntilDone();
    return () => {
      cancelled.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function build() {
    setBuilding(true);
    const res = await fetchJson(`/api/clients/${client.id}/brain/build`, { method: "POST" });
    if (!res.success) {
      setBuilding(false);
      return void toast.error(res.error);
    }
    toast.success("Brand Brain build started.");
    void pollUntilDone();
  }

  async function addSource() {
    setAdding(true);
    const res = await fetchJson(`/api/clients/${client.id}/sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, url: url.trim() }),
    });
    setAdding(false);
    if (!res.success) return void toast.error(res.error);
    toast.success("Source added.");
    setUrl("");
    router.refresh();
  }

  async function removeSource(id: string) {
    if (!confirm("Remove this source?")) return;
    setRemoving(id);
    const res = await fetchJson(`/api/clients/${client.id}/sources`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_id: id }),
    });
    setRemoving(null);
    if (!res.success) return void toast.error(res.error);
    toast.success("Source removed.");
    router.refresh();
  }

  const tokens = lastJob ? (lastJob.prompt_tokens ?? 0) + (lastJob.completion_tokens ?? 0) : 0;
  const dur = lastJob ? duration(lastJob) : null;

  return (
    <div className="space-y-5">
      <section className="bg-surface border border-rule rounded-lg p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-[14px] font-semibold text-ink">Brand Brain</h2>
            <p className="text-[12.5px] text-ink-muted mt-0.5">
              {hasProfile
                ? "Re-run to re-crawl the sources and refresh the profile."
                : "No profile yet. Build it from the sources below."}
            </p>
          </div>
          <Button onClick={build} loading={building} disabled={building}>
            {building ? "Building..." : hasProfile ? "Rebuild Brand Brain" : "Build Brand Brain"}
          </Button>
        </div>

        {lastJob ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-ink-muted border-t border-rule pt-3">
            <Chip tone={JOB_TONE[lastJob.status] ?? "text-ink-muted"}>{lastJob.status}</Chip>
            <span>{relativeTime(lastJob.started_at)}</span>
            {dur && <span>{dur}</span>}
            <span>
              <span className="mono-num">{tokens.toLocaleString()}</span> tokens
            </span>
            <span className="mono-num">${Number(lastJob.cost_usd ?? 0).toFixed(4)}</span>
            {lastJob.output?.facts_kept !== undefined && (
              <span>
                <span className="mono-num">{lastJob.output.facts_kept}</span> facts kept /{" "}
                <span className="mono-num">{lastJob.output.facts_dropped ?? 0}</span> dropped
              </span>
            )}
            {lastJob.error && (
              <span className="text-danger truncate max-w-full" title={lastJob.error}>
                {lastJob.error}
              </span>
            )}
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-subtle border-t border-rule pt-3">No builds yet.</p>
        )}
      </section>

      <section className="bg-surface border border-rule rounded-lg">
        <h2 className="text-[14px] font-semibold text-ink px-5 pt-4 pb-3">Sources</h2>
        {sources.length === 0 ? (
          <p className="px-5 pb-4 text-[12.5px] text-ink-muted">No sources yet. Add one below.</p>
        ) : (
          <ul>
            {sources.map((s) => (
              <li key={s.id} className="flex items-start gap-3 px-5 py-3 border-t border-rule">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-medium text-ink">{s.kind.replace("_", " ")}</span>
                    <Chip tone={SOURCE_STATUS_TONE[s.status] ?? "text-ink-muted"}>{s.status}</Chip>
                    {s.page_count !== null && (
                      <span className="text-[11.5px] text-ink-subtle">{s.page_count} pages</span>
                    )}
                    {s.last_crawled_at && (
                      <span className="text-[11.5px] text-ink-subtle">crawled {relativeTime(s.last_crawled_at)}</span>
                    )}
                  </div>
                  {s.url && <p className="text-[12px] text-ink-muted truncate" title={s.url}>{s.url}</p>}
                  {s.last_error && (
                    <p className="text-[11.5px] text-danger truncate" title={s.last_error}>
                      {s.last_error.length > 140 ? `${s.last_error.slice(0, 140)}...` : s.last_error}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => removeSource(s.id)}
                  loading={removing === s.id}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 px-5 py-3 border-t border-rule">
          <select
            aria-label="Source kind"
            className="bg-surface border border-rule rounded px-2 py-2 text-[13px] text-ink"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {ADDABLE.map((k) => (
              <option key={k} value={k}>
                {k.replace("_", " ")}
              </option>
            ))}
          </select>
          <input
            aria-label="Source URL"
            className="flex-1 min-w-[220px] bg-surface border border-rule rounded px-3 py-2 text-[13px] text-ink"
            placeholder="https://..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button onClick={addSource} loading={adding} disabled={!url.trim()}>
            Add source
          </Button>
        </div>
      </section>
    </div>
  );
}
