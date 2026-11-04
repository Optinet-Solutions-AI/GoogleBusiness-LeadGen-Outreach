"use client";

/**
 * crm/CrmBoard.tsx — the kanban: follow-up strip, filters, one column per sales stage, drag to move.
 *
 * Inputs:  initialCards (from the server page), crmReady (migration 054 applied)
 * Outputs: PATCH /api/leads/:id { stage } on drop (optimistic, toast on failure);
 *          opens <CrmLeadPanel> on card click and applies its edits to the board state
 * Used by: app/(dashboard)/crm/page.tsx
 *
 * Dumb by design: grouping / filtering / buckets come from lib/crm/board.ts (pure).
 * Drag and drop is the browser's own HTML5 API — no extra dependency.
 */
import { useMemo, useState, useCallback } from "react";
import { Search, CalendarClock, X } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { cx } from "@/lib/cx";
import {
  countFollowUps,
  distinctValues,
  filterCards,
  groupIntoColumns,
  NEW_COLUMN_CAP,
  type BoardFilters,
  type CrmCard,
  type CrmColumn,
} from "@/lib/crm/board";
import { CrmCardView } from "./CrmCardView";
import { CrmLeadPanel } from "./CrmLeadPanel";

const OFFER_OPTIONS = [
  { value: "", label: "All offers" },
  { value: "build_website", label: "Build website" },
  { value: "improve_website", label: "Improve website" },
  { value: "voice_agent", label: "AI services" },
  { value: "buy_inventory", label: "Buy inventory" },
];

const TONE_HEAD: Record<CrmColumn["tone"], string> = {
  neutral: "text-ink-muted",
  action: "text-action",
  urgent: "text-urgent",
  warning: "text-warning",
  positive: "text-positive",
};

export function CrmBoard({ initialCards, crmReady }: { initialCards: CrmCard[]; crmReady: boolean }) {
  const [cards, setCards] = useState<CrmCard[]>(initialCards);
  const [filters, setFilters] = useState<BoardFilters>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);

  const visible = useMemo(() => filterCards(cards, filters, now), [cards, filters, now]);
  const columns = useMemo(() => groupIntoColumns(visible), [visible]);
  const followUps = useMemo(() => countFollowUps(cards, now), [cards, now]);
  const distinct = useMemo(() => distinctValues(cards), [cards]);
  const openCard = openId ? cards.find((c) => c.id === openId) ?? null : null;

  const patchCard = useCallback((id: string, patch: Partial<CrmCard>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  async function moveCard(id: string, column: CrmColumn) {
    const card = cards.find((c) => c.id === id);
    if (!card || !column.dropStage || column.stages.includes(card.stage)) return;
    const prevStage = card.stage;
    patchCard(id, { stage: column.dropStage, updated_at: new Date().toISOString() });
    const res = await fetchJson<unknown>(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: column.dropStage }),
    });
    if (!res.success) {
      patchCard(id, { stage: prevStage });
      toast.error(res.error, { title: "Could not move the lead" });
    } else {
      toast.success(`${card.business_name} → ${column.label}`);
    }
  }

  const set = (patch: Partial<BoardFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const dueChip = (key: "overdue" | "today" | "week", label: string, n: number, tone: string) => (
    <button
      type="button"
      onClick={() => set({ due: filters.due === key ? undefined : key })}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors",
        filters.due === key ? "border-ink bg-ink text-surface" : "border-rule bg-surface hover:border-rule-strong",
        filters.due !== key && n > 0 ? tone : filters.due !== key ? "text-ink-muted" : "",
      )}
    >
      <span className="mono-num">{n}</span> {label}
    </button>
  );
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* Follow-up strip + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle font-mono mr-1">
          <CalendarClock className="h-3.5 w-3.5" /> Follow-ups
        </span>
        {dueChip("overdue", "overdue", followUps.overdue, "text-urgent")}
        {dueChip("today", "today", followUps.today, "text-warning")}
        {dueChip("week", "this week", followUps.week, "text-action")}
        <span className="flex-1" />
        <label className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-subtle" />
          <input
            id="crm-search"
            value={filters.q ?? ""}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Search name, email, phone, city…"
            className="h-9 w-64 max-w-full rounded-lg border border-rule-strong bg-surface pl-8 pr-2 text-[13px] text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/20"
          />
        </label>
        <SelectMenu label="Offer" value={filters.offer ?? ""} options={OFFER_OPTIONS} onChange={(v) => set({ offer: v || undefined })} />
        {distinct.owners.length > 0 && (
          <SelectMenu label="Owner" value={filters.owner ?? ""} options={[{ value: "", label: "Anyone" }, ...distinct.owners.map((o) => ({ value: o, label: o }))]} onChange={(v) => set({ owner: v || undefined })} />
        )}
        {distinct.tags.length > 0 && (
          <SelectMenu label="Tag" value={filters.tag ?? ""} options={[{ value: "", label: "Any tag" }, ...distinct.tags.map((t) => ({ value: t, label: t }))]} onChange={(v) => set({ tag: v || undefined })} />
        )}
        {distinct.countries.length > 1 && (
          <SelectMenu label="Country" value={filters.country ?? ""} options={[{ value: "", label: "All" }, ...distinct.countries.map((c) => ({ value: c, label: c.toUpperCase() }))]} onChange={(v) => set({ country: v || undefined })} />
        )}
        {activeFilterCount > 0 && (
          <button type="button" onClick={() => setFilters({})} className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink">
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Board */}
      <div className="overflow-x-auto pb-3 -mx-1 px-1">
        <div className="flex gap-3 min-w-max items-start">
          {columns.map(({ column, cards: colCards, total, mrr }) => {
            const droppable = !!column.dropStage;
            const isOver = overCol === column.key && droppable;
            return (
              <section
                key={column.key}
                className={cx(
                  "w-[272px] shrink-0 rounded-xl border bg-surface-alt/60 transition-colors",
                  isOver ? "border-action ring-2 ring-action/20" : "border-rule",
                  !droppable && dragId ? "opacity-60" : "",
                )}
                onDragOver={(e) => {
                  if (!droppable) return;
                  e.preventDefault();
                  if (overCol !== column.key) setOverCol(column.key);
                }}
                onDragLeave={() => overCol === column.key && setOverCol(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/lead-id") || dragId;
                  setOverCol(null);
                  setDragId(null);
                  if (id) void moveCard(id, column);
                }}
              >
                <header className="flex items-baseline justify-between gap-2 px-3 pt-3 pb-2">
                  <h2 className={cx("text-[11px] font-bold uppercase tracking-[0.14em] font-mono", TONE_HEAD[column.tone])}>{column.label}</h2>
                  <span className="mono-num text-[12px] text-ink-muted">
                    {total}
                    {column.key === "closed_won" && mrr > 0 && <span className="ml-1.5 text-positive">${mrr.toLocaleString()}/mo</span>}
                  </span>
                </header>
                <div className="px-2 pb-2 space-y-2 min-h-[80px] max-h-[calc(100vh-290px)] overflow-y-auto">
                  {colCards.map((c) => (
                    <CrmCardView
                      key={c.id}
                      card={c}
                      now={now}
                      dragging={dragId === c.id}
                      onOpen={() => setOpenId(c.id)}
                      onDragStart={(e) => {
                        setDragId(c.id);
                        e.dataTransfer.setData("text/lead-id", c.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverCol(null);
                      }}
                    />
                  ))}
                  {colCards.length === 0 && (
                    <p className="px-2 py-6 text-center text-[12px] text-ink-subtle">{droppable ? "Drop a card here" : "Nothing waiting"}</p>
                  )}
                  {column.key === "new" && total > NEW_COLUMN_CAP && (
                    <a href="/leads" className="block px-2 py-2 text-center text-[12px] text-action hover:underline">
                      +{total - NEW_COLUMN_CAP} more on the Leads page
                    </a>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {openCard && (
        <CrmLeadPanel
          card={openCard}
          crmReady={crmReady}
          onClose={() => setOpenId(null)}
          onChange={(patch) => patchCard(openCard.id, patch)}
        />
      )}
    </div>
  );
}
