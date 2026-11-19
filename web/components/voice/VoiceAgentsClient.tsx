"use client";
/**
 * voice/VoiceAgentsClient.tsx — add, edit, set default and archive voice agents (Voizo scripts) (19 Nov 2026).
 *
 * Inputs:  GET /api/voice-agents(?archived=1)
 * Outputs: POST /api/voice-agents, PATCH /api/voice-agents/:id (fields, is_default, archived)
 * Used by: app/(dashboard)/voice-agents/page.tsx
 *
 * Dumb client. The scripts themselves live in Voizo's Script Builder; this list only names them for Call with AI.
 */
import { useCallback, useEffect, useState } from "react";
import { Plus, Star, Archive, ArchiveRestore, Save, X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

interface Agent {
  id: string;
  name: string;
  voizo_campaign_id: string;
  script_builder_url: string | null;
  notes: string | null;
  is_default: boolean;
  archived: boolean;
}
type Draft = { name: string; voizo_campaign_id: string; script_builder_url: string; notes: string; is_default: boolean };

const EMPTY: Draft = { name: "", voizo_campaign_id: "", script_builder_url: "", notes: "", is_default: false };
const INPUT = "w-full px-3 py-2 text-[13px] border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none";

export function VoiceAgentsClient() {
  const [list, setList] = useState<Agent[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchJson<{ agents: Agent[]; missing: boolean }>(`/api/voice-agents${showArchived ? "?archived=1" : ""}`);
    if (r.success) {
      setList(r.data.agents);
      setMissing(r.data.missing);
    } else toast.error(r.error, { title: "Couldn't load voice agents" });
  }, [showArchived]);
  useEffect(() => {
    void load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>, done: string) {
    const r = await fetchJson<Agent>(`/api/voice-agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.success) return void toast.error(r.error);
    toast.success(done);
    void load();
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    const d = editing.draft;
    const body = {
      name: d.name.trim(),
      voizo_campaign_id: d.voizo_campaign_id.trim(),
      script_builder_url: d.script_builder_url.trim() || null,
      notes: d.notes.trim() || null,
      is_default: d.is_default,
    };
    const r = await fetchJson<Agent>(editing.id ? `/api/voice-agents/${editing.id}` : "/api/voice-agents", {
      method: editing.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.success) return void toast.error(r.error, { title: "Not saved" });
    toast.success("Voice agent saved.");
    setEditing(null);
    void load();
  }

  if (missing) {
    return (
      <div className="mt-6 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-ink">
        Voice agents need database update 064. Run <span className="font-mono">db/migrations/064_templates_agents.sql</span> in Supabase, then reload.
      </div>
    );
  }

  const set = (k: keyof Draft, v: string | boolean) => editing && setEditing({ ...editing, draft: { ...editing.draft, [k]: v } });

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button onClick={() => setEditing({ id: null, draft: { ...EMPTY } })}>
          <Plus className="h-4 w-4" /> Add voice agent
        </Button>
        <label className="text-[12px] text-ink-muted flex items-center gap-1.5">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        </label>
      </div>

      {editing && (
        <section className="bg-surface border border-rule rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-muted">{editing.id ? "Edit voice agent" : "New voice agent"}</div>
            <button type="button" onClick={() => setEditing(null)} className="text-ink-muted hover:text-ink" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <input className={INPUT} placeholder="Name (e.g. Reputation management, Website offer)" value={editing.draft.name} onChange={(e) => set("name", e.target.value)} />
          <input className={INPUT} placeholder="Voizo campaign ID (the API campaign that runs this script, not the script ID)" value={editing.draft.voizo_campaign_id} onChange={(e) => set("voizo_campaign_id", e.target.value)} />
          <input className={INPUT} placeholder="Script Builder link (…/script-builder?id=…), where you talk to it with ▶ Start test call" value={editing.draft.script_builder_url} onChange={(e) => set("script_builder_url", e.target.value)} />
          <input className={INPUT} placeholder="Notes (optional)" value={editing.draft.notes} onChange={(e) => set("notes", e.target.value)} />
          <label className="text-[12px] text-ink flex items-center gap-1.5">
            <input type="checkbox" checked={editing.draft.is_default} onChange={(e) => set("is_default", e.target.checked)} /> Default agent (preselected in Call with AI)
          </label>
          <p className="text-[11px] text-ink-muted">
            Calls dial the Voizo <b>campaign</b> (Draft, marked as test, source &ldquo;api&rdquo;, with its assistant set up), or Voizo refuses the call. Talk to the script first in Script Builder (&#9654; Start test call, from your browser, no phone needed).
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={busy || !editing.draft.name.trim() || !editing.draft.voizo_campaign_id.trim()}>
              <Save className="h-4 w-4" /> Save
            </Button>
          </div>
        </section>
      )}

      {list === null ? (
        <div className="text-[13px] text-ink-muted">Loading…</div>
      ) : list.length === 0 ? (
        <div className="text-[13px] text-ink-muted">No voice agents yet. Calls use Voizo&apos;s default script until you add one.</div>
      ) : (
        <div className="bg-surface border border-rule rounded-lg divide-y divide-rule">
          {list.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-ink truncate">
                  {a.name}
                  {a.is_default && <span className="ml-2 text-[11px] text-positive">default</span>}
                  {a.archived && <span className="ml-2 text-[11px] text-ink-muted">(archived)</span>}
                </div>
                <div className="text-[12px] text-ink-muted truncate font-mono">{a.voizo_campaign_id}</div>
              </div>
              {a.script_builder_url && (
                <a href={a.script_builder_url} target="_blank" rel="noreferrer" className="text-[12px] text-action hover:underline flex items-center gap-1">
                  Test in Script Builder <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {!a.is_default && !a.archived && (
                <Button size="sm" variant="ghost" onClick={() => patch(a.id, { is_default: true }, `${a.name} is now the default.`)}>
                  <Star className="h-4 w-4" /> Make default
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setEditing({
                    id: a.id,
                    draft: { name: a.name, voizo_campaign_id: a.voizo_campaign_id, script_builder_url: a.script_builder_url ?? "", notes: a.notes ?? "", is_default: a.is_default },
                  })
                }
              >
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => patch(a.id, { archived: !a.archived }, a.archived ? "Back in the list." : "Archived.")}>
                {a.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />} {a.archived ? "Unarchive" : "Archive"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
