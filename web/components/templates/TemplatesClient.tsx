"use client";
/**
 * templates/TemplatesClient.tsx — list, add, edit, archive and restore saved email templates (19 Nov 2026).
 *
 * Inputs:  GET /api/email-templates(?archived=1), GET /api/email-templates/:id/versions
 * Outputs: POST /api/email-templates (new), PATCH /:id (edit → new version, or archive), POST /:id/restore {version}
 * Used by: app/(dashboard)/email-templates/page.tsx
 *
 * Dumb client: shows data, fires actions. Placeholders are filled per lead by lib/email/template-render.ts.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Plus, Archive, ArchiveRestore, Save, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { SERVICES } from "@/lib/email/service-templates";
import { TEMPLATE_TOKENS, unknownTokens } from "@/lib/email/template-render";

interface Template {
  id: string;
  name: string;
  service_key: string | null;
  subject: string;
  body: string;
  follow_up_1: string;
  follow_up_2: string;
  version: number;
  archived: boolean;
  updated_at: string;
}
interface Version {
  version: number;
  name: string;
  subject: string;
  body: string;
  follow_up_1: string;
  follow_up_2: string;
  note?: string | null;
  created_at?: string;
}
type Draft = Pick<Template, "name" | "service_key" | "subject" | "body" | "follow_up_1" | "follow_up_2">;

const EMPTY: Draft = { name: "", service_key: null, subject: "", body: "", follow_up_1: "", follow_up_2: "" };
const INPUT = "w-full px-3 py-2 text-[13px] border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none";
const offerLabel = (k: string | null) => SERVICES.find((s) => s.key === k)?.label ?? "Any offer";

export function TemplatesClient() {
  const [list, setList] = useState<Template[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [history, setHistory] = useState<{ id: string; name: string; versions: Version[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchJson<{ templates: Template[]; missing: boolean }>(`/api/email-templates${showArchived ? "?archived=1" : ""}`);
    if (r.success) {
      setList(r.data.templates);
      setMissing(r.data.missing);
    } else toast.error(r.error, { title: "Couldn't load templates" });
  }, [showArchived]);
  useEffect(() => {
    void load();
  }, [load]);

  const unknown = useMemo(
    () => (editing ? unknownTokens([editing.draft.subject, editing.draft.body, editing.draft.follow_up_1, editing.draft.follow_up_2].join("\n")) : []),
    [editing],
  );

  async function save() {
    if (!editing) return;
    setBusy(true);
    const r = await fetchJson<Template>(editing.id ? `/api/email-templates/${editing.id}` : "/api/email-templates", {
      method: editing.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing.draft),
    });
    setBusy(false);
    if (!r.success) return void toast.error(r.error, { title: "Not saved" });
    toast.success(editing.id ? `Saved as version ${r.data.version}.` : "Template saved.");
    setEditing(null);
    void load();
  }

  async function setArchived(t: Template, archived: boolean) {
    const r = await fetchJson<Template>(`/api/email-templates/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    if (!r.success) return void toast.error(r.error);
    toast.success(archived ? "Archived (still in the history)." : "Back in the list.");
    void load();
  }

  async function openHistory(t: Template) {
    const r = await fetchJson<Version[]>(`/api/email-templates/${t.id}/versions`);
    if (!r.success) return void toast.error(r.error);
    setHistory({ id: t.id, name: t.name, versions: r.data });
  }

  async function restore(version: number) {
    if (!history) return;
    const r = await fetchJson<Template>(`/api/email-templates/${history.id}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
    });
    if (!r.success) return void toast.error(r.error);
    toast.success(`Version ${version} restored as version ${r.data.version}.`);
    setHistory(null);
    void load();
  }

  if (missing) {
    return (
      <div className="mt-6 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-ink">
        Saved templates need database update 064. Run <span className="font-mono">db/migrations/064_templates_agents.sql</span> in Supabase, then reload.
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button onClick={() => setEditing({ id: null, draft: { ...EMPTY } })}>
          <Plus className="h-4 w-4" /> New template
        </Button>
        <label className="text-[12px] text-ink-muted flex items-center gap-1.5">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        </label>
      </div>

      {editing && (
        <section className="bg-surface border border-rule rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-muted">{editing.id ? "Edit template" : "New template"}</div>
            <button type="button" onClick={() => setEditing(null)} className="text-ink-muted hover:text-ink" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input className={INPUT} placeholder="Template name" value={editing.draft.name} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })} />
            <select
              className={INPUT}
              value={editing.draft.service_key ?? ""}
              onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, service_key: e.target.value || null } })}
            >
              <option value="">Any offer</option>
              {SERVICES.filter((s) => s.key !== "custom").map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          <input className={INPUT} placeholder="Subject" value={editing.draft.subject} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, subject: e.target.value } })} />
          <textarea className={INPUT} rows={9} placeholder="Email" value={editing.draft.body} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, body: e.target.value } })} />
          <textarea className={INPUT} rows={3} placeholder="Follow-up 1 (optional, day 4)" value={editing.draft.follow_up_1} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, follow_up_1: e.target.value } })} />
          <textarea className={INPUT} rows={3} placeholder="Follow-up 2 (optional, day 8)" value={editing.draft.follow_up_2} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, follow_up_2: e.target.value } })} />
          <div className="text-[11px] text-ink-muted leading-relaxed">
            Placeholders filled for each lead:{" "}
            {TEMPLATE_TOKENS.map((t) => (
              <code key={t} className="mr-1 rounded bg-surface-alt px-1">{`{{${t}}}`}</code>
            ))}
            . A line with only an empty placeholder (like a demo link the lead doesn&apos;t have) is left out.
          </div>
          {unknown.length > 0 && (
            <div className="text-[12px] text-warning">
              Not a placeholder (check the spelling): {unknown.map((u) => `{{${u}}}`).join(", ")}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={busy || !editing.draft.name.trim() || !editing.draft.subject.trim() || !editing.draft.body.trim()}>
              <Save className="h-4 w-4" /> {editing.id ? "Save as new version" : "Save template"}
            </Button>
          </div>
        </section>
      )}

      {history && (
        <section className="bg-surface border border-rule rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-muted">History · {history.name}</div>
            <button type="button" onClick={() => setHistory(null)} className="text-ink-muted hover:text-ink" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          {history.versions.map((v, i) => (
            <details key={v.version} className="border border-rule rounded-lg px-3 py-2">
              <summary className="cursor-pointer text-[13px]">
                <span className="font-semibold">Version {v.version}</span>
                {i === 0 && <span className="ml-2 text-positive">current</span>}
                {v.note && <span className="ml-2 text-ink-muted">({v.note})</span>}
                {v.created_at && <span className="ml-2 text-ink-subtle text-[11px]">{new Date(v.created_at).toLocaleString()}</span>}
              </summary>
              <div className="mt-2 text-[12px] whitespace-pre-wrap">
                <div className="font-semibold">{v.subject}</div>
                <div className="mt-1">{v.body}</div>
              </div>
              {i > 0 && (
                <Button className="mt-2" size="sm" variant="secondary" onClick={() => restore(v.version)}>
                  Restore this version
                </Button>
              )}
            </details>
          ))}
        </section>
      )}

      {list === null ? (
        <div className="text-[13px] text-ink-muted">Loading…</div>
      ) : list.length === 0 ? (
        <div className="text-[13px] text-ink-muted">No saved templates yet. Add one here, or use &ldquo;Save as template&rdquo; in Send email.</div>
      ) : (
        <div className="bg-surface border border-rule rounded-lg divide-y divide-rule">
          {list.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-ink truncate">
                  {t.name} {t.archived && <span className="text-[11px] text-ink-muted">(archived)</span>}
                </div>
                <div className="text-[12px] text-ink-muted truncate">
                  {offerLabel(t.service_key)} · version {t.version} · {t.subject}
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setEditing({ id: t.id, draft: { name: t.name, service_key: t.service_key, subject: t.subject, body: t.body, follow_up_1: t.follow_up_1, follow_up_2: t.follow_up_2 } })}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => openHistory(t)}>
                <History className="h-4 w-4" /> History
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setArchived(t, !t.archived)}>
                {t.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />} {t.archived ? "Unarchive" : "Archive"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
