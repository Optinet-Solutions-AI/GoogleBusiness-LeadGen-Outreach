/**
 * TestListClient.tsx — the Test list page: QA adds or removes their own email / phone so test sends reach them.
 *
 * Inputs:  GET /api/test-mode (the list); POST /api/test-mode { action, kind, value }
 * Outputs: the instructions, the list with Remove, and an Add form that needs "this is mine, not a business's" ticked
 * Used by: app/(dashboard)/test-list/page.tsx
 *
 * Dumb: the server checks the format and refuses duplicates. There is no Go live switch here on purpose.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, Phone, Trash2, Globe } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

interface Mode {
  on: boolean;
  emails: string[];
  phones: string[];
  hosts: string[];
}

const INPUT = "h-9 w-full px-3 text-[13px] text-ink border border-rule-strong rounded-lg bg-white focus:ring-2 focus:ring-action/20 focus:border-action outline-none";

export function TestListClient() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"email" | "phone">("email");
  const [value, setValue] = useState("");
  const [mine, setMine] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchJson<Mode>("/api/test-mode");
    if (r.success) setMode(r.data);
    else setError(r.error);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function change(action: "add" | "remove", k: "email" | "phone", v: string) {
    if (action === "remove" && !window.confirm(`Remove ${v} from the test list? Test sends to it will be refused.`)) return;
    setBusy(true);
    const r = await fetchJson<Mode>("/api/test-mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, kind: k, value: v }) });
    setBusy(false);
    if (!r.success) return void toast.warning(r.error);
    setMode(r.data);
    if (action === "add") {
      setValue("");
      setMine(false);
      toast.success("Added. Test sends to it work within about 30 seconds.");
    } else toast.success("Removed.");
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <section className="rounded-lg border border-action/30 bg-action/5 p-4 text-[13px] text-ink space-y-2">
        <p className="font-semibold">How testing works</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>
            Add <span className="font-semibold">your own</span> email address and phone number below (and a teammate&rsquo;s if they test with you). Never
            add a business&rsquo;s email or phone.
          </li>
          <li>
            On a lead you test with, set its <span className="font-semibold">email</span> and <span className="font-semibold">phone</span> to the ones on this
            list, and its <span className="font-semibold">contact page</span> to the RateUp test form: <span className="mono-num">/test-form</span>.
          </li>
          <li>Test as normal: Send email, Contact page, Call with AI, batch emails, the Brain.</li>
          <li>
            Anything addressed to someone <span className="font-semibold">not</span> on this list is refused with &ldquo;Test mode is on&rdquo; (or waits until
            the app goes live). That is the safeguard working, not a bug: nothing was sent.
          </li>
          <li>Only Chris can switch the app to live. There is no button for it.</li>
        </ol>
      </section>

      {error && <p className="rounded-lg border border-urgent/30 bg-urgent-soft px-3 py-2 text-[12px] text-ink">{error}</p>}
      {mode && !mode.on && (
        <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] text-ink">
          The app is <span className="font-semibold">live</span>: Test mode is off and sends go to real businesses. This list is not used until Chris switches
          Test mode back on.
        </p>
      )}

      {mode && (
        <section className="rounded-lg border border-rule bg-surface p-4 space-y-3">
          <p className="text-[13px] font-semibold text-ink">On the test list</p>
          <ul className="divide-y divide-rule text-[13px] text-ink">
            {mode.emails.map((e) => (
              <li key={e} className="flex items-center gap-2 py-1.5">
                <Mail className="h-3.5 w-3.5 text-ink-muted" aria-hidden /> <span className="flex-1 mono-num">{e}</span>
                <button type="button" disabled={busy} onClick={() => void change("remove", "email", e)} className="text-ink-subtle hover:text-urgent" aria-label={`Remove ${e}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {mode.phones.map((p) => (
              <li key={p} className="flex items-center gap-2 py-1.5">
                <Phone className="h-3.5 w-3.5 text-ink-muted" aria-hidden /> <span className="flex-1 mono-num">{p}</span>
                <button type="button" disabled={busy} onClick={() => void change("remove", "phone", p)} className="text-ink-subtle hover:text-urgent" aria-label={`Remove ${p}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {mode.hosts.map((h) => (
              <li key={h} className="flex items-center gap-2 py-1.5 text-ink-muted">
                <Globe className="h-3.5 w-3.5" aria-hidden /> <span className="flex-1 mono-num">{h}</span>
                <span className="text-[11px]">contact forms (the RateUp test form) · set by Chris</span>
              </li>
            ))}
            {!mode.emails.length && !mode.phones.length && <li className="py-1.5 text-ink-muted">No email or phone yet: add yours below before testing.</li>}
          </ul>

          <form
            className="space-y-2 border-t border-rule pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (mine && value.trim()) void change("add", kind, value);
            }}
          >
            <p className="text-[12px] font-semibold text-ink">Add</p>
            <div className="flex flex-wrap gap-2">
              <select value={kind} onChange={(e) => setKind(e.target.value as "email" | "phone")} className={`${INPUT} w-32`} aria-label="Email or phone">
                <option value="email">Email</option>
                <option value="phone">Phone</option>
              </select>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={kind === "email" ? "you@example.com" : "+63 917 123 4567 (with country code)"}
                className={`${INPUT} flex-1 min-w-[220px]`}
                aria-label={kind === "email" ? "Email address" : "Phone number"}
                maxLength={120}
              />
            </div>
            <label className="flex items-start gap-1.5 text-[12px] text-ink">
              <input type="checkbox" className="mt-0.5" checked={mine} onChange={(e) => setMine(e.target.checked)} />
              This is my own (or a teammate&rsquo;s) {kind === "email" ? "email address" : "phone number"}, not a business&rsquo;s.
            </label>
            <Button type="submit" size="sm" loading={busy} disabled={busy || !mine || !value.trim()}>
              Add to the test list
            </Button>
          </form>
        </section>
      )}
    </div>
  );
}
