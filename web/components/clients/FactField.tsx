"use client";

/**
 * FactField.tsx — one editable, sourced profile field (value input per kind + source chip + confirm tick).
 *
 * Inputs:  path, label, kind, fact (the raw value at that path: Fact | null | Fact[]), callbacks
 * Outputs: onChange(newRawValue) — edited facts become operator-sourced + confirmed ONLY when the value changed;
 *          onConfirm() — operator ticks the field as correct (source kept). AI voice entries show "AI summary".
 * Used by: components/clients/BrainEditor.tsx
 */

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { cx } from "@/lib/cx";
import { isAiSummary, type FieldKind } from "@/lib/clients/profile-paths";
import type { Fact, FactSource } from "@/lib/clients/types";

type Audience = { name: string; description: string; pains: string[]; wants: string[] };
type Cta = { text: string; kind: "call" | "book" | "visit" | "message" | "website" };
const CTA_KINDS: Cta["kind"][] = ["call", "book", "visit", "message", "website"];

const INPUT = "w-full bg-surface border border-rule rounded px-2.5 py-1.5 text-[13px] text-ink";
const OPERATOR: FactSource = { kind: "operator" };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Wrap a value as an operator fact, keeping `prev` untouched when the value did not change. */
function editFact<T>(prev: Fact<T> | null | undefined, value: T): Fact<T> {
  if (prev && same(prev.value, value)) return prev;
  return { value, source: OPERATOR, confirmed: true };
}

export function SourceChip({ source, aiSummary = false }: { source: FactSource; aiSummary?: boolean }) {
  const [open, setOpen] = useState(false);
  const label = aiSummary ? (
    <span title={`AI summary of the ${source.kind} material`}>AI summary</span>
  ) : source.url ? (
    <a href={source.url} target="_blank" rel="noreferrer" className="underline decoration-dotted">
      {source.kind}
    </a>
  ) : (
    <span>{source.kind}</span>
  );
  return (
    <span className="inline-flex flex-col items-start">
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-rule bg-surface-alt text-[10.5px] text-ink-muted"
        title={source.quote ?? undefined}
      >
        {label}
        {source.quote && (
          <button type="button" aria-label="Show quote" className="text-ink-subtle" onClick={() => setOpen((o) => !o)}>
            “”
          </button>
        )}
      </span>
      {open && source.quote && <span className="text-[11px] text-ink-muted italic mt-1 max-w-md">“{source.quote}”</span>}
    </span>
  );
}

function ChipList({ items, onChange }: { items: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v) onChange([...items, v]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-alt border border-rule text-[12px]">
          {it}
          <button type="button" aria-label={`Remove ${it}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        className="bg-surface border border-rule rounded px-2 py-0.5 text-[12px] w-36"
        placeholder="Add…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

function FactList({
  path,
  facts,
  onChange,
}: {
  path: string;
  facts: Fact<string>[];
  onChange: (next: Fact<string>[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v) onChange([...facts, { value: v, source: OPERATOR, confirmed: true }]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {facts.map((f, i) => (
        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-alt border border-rule text-[12px]">
          {f.value}
          <SourceChip source={f.source} aiSummary={isAiSummary(path, f)} />
          <button type="button" aria-label={`Remove ${f.value}`} onClick={() => onChange(facts.filter((_, j) => j !== i))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        className="bg-surface border border-rule rounded px-2 py-0.5 text-[12px] w-36"
        placeholder="Add…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

function AudienceCards({ facts, onChange }: { facts: Fact<Audience>[]; onChange: (n: Fact<Audience>[]) => void }) {
  const update = (i: number, patch: Partial<Audience>) =>
    onChange(facts.map((f, j) => (j === i ? editFact(f, { ...f.value, ...patch }) : f)));
  return (
    <div className="space-y-2">
      {facts.map((f, i) => (
        <div key={i} className="border border-rule rounded p-3 space-y-2 bg-surface-alt/40">
          <div className="flex items-center justify-between gap-2">
            <input className={INPUT} placeholder="Audience name" value={f.value.name} onChange={(e) => update(i, { name: e.target.value })} />
            <SourceChip source={f.source} />
            <button type="button" aria-label="Remove audience" onClick={() => onChange(facts.filter((_, j) => j !== i))}>
              <X size={14} />
            </button>
          </div>
          <textarea className={INPUT} rows={2} placeholder="Description" value={f.value.description} onChange={(e) => update(i, { description: e.target.value })} />
          <div className="text-[11px] text-ink-subtle">Pains</div>
          <ChipList items={f.value.pains} onChange={(pains) => update(i, { pains })} />
          <div className="text-[11px] text-ink-subtle">Wants</div>
          <ChipList items={f.value.wants} onChange={(wants) => update(i, { wants })} />
        </div>
      ))}
      <button
        type="button"
        className="inline-flex items-center gap-1 text-[12px] text-ink-muted"
        onClick={() => onChange([...facts, { value: { name: "", description: "", pains: [], wants: [] }, source: OPERATOR, confirmed: true }])}
      >
        <Plus size={12} /> Add audience
      </button>
    </div>
  );
}

function CtaRows({ facts, onChange }: { facts: Fact<Cta>[]; onChange: (n: Fact<Cta>[]) => void }) {
  const update = (i: number, patch: Partial<Cta>) =>
    onChange(facts.map((f, j) => (j === i ? editFact(f, { ...f.value, ...patch }) : f)));
  return (
    <div className="space-y-2">
      {facts.map((f, i) => (
        <div key={i} className="flex items-center gap-2">
          <input className={INPUT} placeholder="Button text" value={f.value.text} onChange={(e) => update(i, { text: e.target.value })} />
          <select className="bg-surface border border-rule rounded px-2 py-1.5 text-[13px]" value={f.value.kind} onChange={(e) => update(i, { kind: e.target.value as Cta["kind"] })}>
            {CTA_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <SourceChip source={f.source} />
          <button type="button" aria-label="Remove CTA" onClick={() => onChange(facts.filter((_, j) => j !== i))}>
            <X size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="inline-flex items-center gap-1 text-[12px] text-ink-muted"
        onClick={() => onChange([...facts, { value: { text: "", kind: "call" }, source: OPERATOR, confirmed: true }])}
      >
        <Plus size={12} /> Add CTA
      </button>
    </div>
  );
}

function isConfirmed(fact: unknown): boolean {
  if (Array.isArray(fact)) return fact.length > 0 && fact.every((f) => (f as Fact<unknown>).confirmed);
  return !!fact && (fact as Fact<unknown>).confirmed;
}

export function FactField({
  path,
  label,
  kind,
  fact,
  onChange,
  onConfirm,
}: {
  path: string;
  label: string;
  kind: FieldKind;
  fact: unknown;
  onChange: (value: unknown) => void;
  onConfirm: () => void;
}) {
  const isArr = Array.isArray(fact);
  const scalar = !isArr ? ((fact as Fact<string> | null) ?? null) : null;
  const setScalar = (text: string) => onChange(text === "" ? null : editFact(scalar, text));
  const hasValue = isArr ? fact.length > 0 : !!scalar;
  const confirmed = isConfirmed(fact);

  let input: React.ReactNode;
  if (kind === "list") input = <FactList path={path} facts={(fact as Fact<string>[]) ?? []} onChange={onChange} />;
  else if (kind === "audiences") input = <AudienceCards facts={(fact as Fact<Audience>[]) ?? []} onChange={onChange} />;
  else if (kind === "ctas") input = <CtaRows facts={(fact as Fact<Cta>[]) ?? []} onChange={onChange} />;
  else if (kind === "textarea")
    input = <textarea aria-label={label} className={INPUT} rows={3} value={scalar?.value ?? ""} onChange={(e) => setScalar(e.target.value)} />;
  else if (kind === "hex")
    input = (
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          className="h-8 w-10 p-0 border border-rule rounded bg-surface"
          value={/^#[0-9a-fA-F]{6}$/.test(scalar?.value ?? "") ? scalar!.value : "#000000"}
          onChange={(e) => setScalar(e.target.value)}
        />
        <input aria-label={label} className={cx(INPUT, "max-w-[9rem]")} placeholder="#rrggbb" value={scalar?.value ?? ""} onChange={(e) => setScalar(e.target.value)} />
      </div>
    );
  else input = <input aria-label={label} className={INPUT} value={scalar?.value ?? ""} onChange={(e) => setScalar(e.target.value)} />;

  return (
    <div data-path={path} className="py-2 border-b border-rule last:border-b-0">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[12px] font-medium text-ink">{label}</span>
        {scalar && <SourceChip source={scalar.source} aiSummary={isAiSummary(path, scalar)} />}
        {hasValue && (
          <button
            type="button"
            aria-label={confirmed ? `${label} confirmed` : `Confirm ${label}`}
            aria-pressed={confirmed}
            disabled={confirmed}
            onClick={onConfirm}
            className={cx(
              "ml-auto inline-flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 border",
              confirmed ? "text-positive border-positive/40" : "text-ink-muted border-rule hover:text-ink",
            )}
          >
            <Check size={12} /> {confirmed ? "confirmed" : "confirm"}
          </button>
        )}
      </div>
      {input}
    </div>
  );
}
