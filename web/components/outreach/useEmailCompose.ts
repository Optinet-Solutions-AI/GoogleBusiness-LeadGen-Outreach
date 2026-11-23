/**
 * outreach/useEmailCompose.ts — the "write the message" state shared by the Send email and Contact form windows:
 * mailbox, offer (ready-made or saved template), subject, body, follow-ups, demo-link switch, Regenerate, Save as template.
 *
 * Inputs:  a lead id; GET /api/leads/:id/send-email (details the templates fill), /api/email-accounts (From list),
 *          /api/email-templates (saved templates); POST …/send-email/regenerate, POST /api/email-templates
 * Outputs: the state + actions; `used` (which email this is, + the wording test's version) for the send; nothing is
 *          sent from here
 * Used by: components/outreach/SimpleEmailModal.tsx, components/outreach/ContactFormModal.tsx (via ComposeFields)
 *
 * Dumb client logic only: the templates are pure text (lib/email/service-templates.ts, template-render.ts).
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { spamCheck } from "@/lib/email/spam-check";
import { textToHtml } from "@/lib/email/plain-text";
import { serviceEmail, type ServiceKey } from "@/lib/email/service-templates";
import { leftoverTokens, renderTemplate, tokenize, usesToken, varsForLead } from "@/lib/email/template-render";
import { startingEmail, type Variant, type WindowTest } from "@/lib/email/wording-test";

export interface ComposeContext {
  leadId: string;
  businessName: string;
  email: string | null;
  emailLabel: string;
  emailTone: "positive" | "warning" | "urgent" | "muted";
  emailHint: string;
  canEmail: boolean;
  unchecked: boolean;
  ownerName: string | null;
  city: string | null;
  category: string | null;
  demoUrl: string | null;
  eventName: string | null;
  booth: string | null;
  platform: string | null;
  rating: number | null;
  reviewCount: number | null;
  preferredSender: string | null;
  defaultService: ServiceKey;
  followUpsActive: boolean;
  /** Running wording tests and past winners (Templates page, 24 Nov 2026). */
  wordingTests?: WindowTest[];
  winners?: Record<string, string>;
}
export type Mailbox = { email: string; from_name: string | null };
/** A saved template (Templates page, migration 064). */
export type SavedTemplate = { id: string; name: string; service_key: string | null; subject: string; body: string; follow_up_1: string; follow_up_2: string };
/** Offers whose email can carry the demo-site link. */
const LINK_OFFERS = new Set<string>(["website_build", "website_redesign"]);

/**
 * @param showFollowUps whether follow-ups may be chosen at all (a saved template's follow-ups are only taken when shown)
 */
export function useEmailCompose(leadId: string, showFollowUps: boolean) {
  const [ctx, setCtx] = useState<ComposeContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mailboxes, setMailboxes] = useState<Mailbox[] | null>(null);
  const [from, setFrom] = useState("");
  const [service, setService] = useState<ServiceKey>("custom");
  const [subject, setSubjectRaw] = useState("");
  const [body, setBodyRaw] = useState("");
  const [followCount, setFollowCount] = useState<0 | 1 | 2>(0);
  const [followUps, setFollowUps] = useState<[string, string]>(["", ""]);
  // True once the operator types: changing the service / mailbox then asks before replacing their words.
  const [edited, setEdited] = useState(false);
  // Saved templates (Templates page) + which one is picked (null = a built-in offer template).
  const [saved, setSaved] = useState<SavedTemplate[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  // Website / redesign emails: include the demo-site link or not (19 Nov 2026).
  const [includeLink, setIncludeLink] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [savingTpl, setSavingTpl] = useState(false);
  // A saved template that mentions the demo link, filled for a lead without one (or with the link switched off):
  // it would claim a sample exists. Blocks sending until the operator rewrites the text.
  const [demoGap, setDemoGap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The wording test whose version is filled in (null = no test, or the operator picked something else).
  const [test, setTest] = useState<{ id: string; variant: Variant } | null>(null);

  const senderName = (mailboxes ?? []).find((m) => m.email === from)?.from_name ?? null;

  function fill(next: ServiceKey, c: ComposeContext, sender: string | null, link: boolean = includeLink) {
    const t = serviceEmail(next, {
      businessName: c.businessName,
      ownerName: c.ownerName,
      city: c.city,
      category: c.category,
      demoUrl: link ? c.demoUrl : null,
      eventName: c.eventName,
      booth: c.booth,
      platform: c.platform,
      rating: c.rating,
      reviewCount: c.reviewCount,
      senderName: sender,
    });
    setService(next);
    setSavedId(null);
    setDemoGap(false);
    setSubjectRaw(t.subject);
    setBodyRaw(t.body);
    setFollowUps(t.followUps);
    setEdited(false);
  }

  /** This lead's values for template placeholders (demo link left out when the switch is off). */
  function leadVars(c: ComposeContext, sender: string | null, link: boolean = includeLink) {
    return varsForLead({ ...c, demoUrl: link ? c.demoUrl : null, senderName: sender });
  }

  function fillSaved(t: SavedTemplate, c: ComposeContext, sender: string | null, link: boolean = includeLink) {
    const v = leadVars(c, sender, link);
    setSavedId(t.id);
    setDemoGap(usesToken([t.subject, t.body, t.follow_up_1, t.follow_up_2], "demo_link") && !v.demo_link);
    setSubjectRaw(renderTemplate(t.subject, v));
    setBodyRaw(renderTemplate(t.body, v));
    setFollowUps([renderTemplate(t.follow_up_1, v), renderTemplate(t.follow_up_2, v)]);
    // Follow-ups only when the follow-up options are shown — never scheduled unseen.
    setFollowCount(!showFollowUps ? 0 : t.follow_up_2.trim() ? 2 : t.follow_up_1.trim() ? 1 : 0);
    setEdited(false);
  }

  /**
   * An offer was picked (or the window opened on it): fill a running wording test's version whose turn it is, else
   * the saved template that won its last test, else its ready-made email (lib/email/wording-test.ts startingEmail).
   */
  function startOffer(offer: ServiceKey, c: ComposeContext, sender: string | null, list: SavedTemplate[]) {
    const s = startingEmail(offer, c.wordingTests ?? [], c.winners ?? {});
    const t = s.key.startsWith("saved:") ? list.find((x) => `saved:${x.id}` === s.key) : undefined;
    if (t) {
      fillSaved(t, c, sender);
      setService(offer);
      setTest(s.test);
    } else if (s.key === `service:${offer}`) {
      fill(offer, c, sender);
      setTest(s.test);
    } else {
      // The template a test or a winner names was archived: the ready-made email, outside any test.
      fill(offer, c, sender);
      setTest(null);
    }
  }

  /** Re-fill whatever is picked (built-in or saved) — after the mailbox or the link switch changes. */
  function refill(c: ComposeContext, sender: string | null, link: boolean) {
    const t = savedId ? saved.find((x) => x.id === savedId) : undefined;
    if (t) fillSaved(t, c, sender, link);
    else fill(service, c, sender, link);
  }

  async function regenerate() {
    if (!subject.trim() || !body.trim()) return;
    setRegenerating(true);
    setError(null);
    const r = await fetchJson<{ subject: string; body: string; followUps: string[] }>(`/api/leads/${leadId}/send-email/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body, followUps }),
    });
    setRegenerating(false);
    if (!r.success) return void setError(r.error);
    setSubjectRaw(r.data.subject);
    setBodyRaw(r.data.body);
    setFollowUps([r.data.followUps[0] ?? followUps[0], r.data.followUps[1] ?? followUps[1]]);
    setEdited(true);
  }

  async function saveAsTemplate() {
    if (!ctx || !subject.trim() || !body.trim()) return;
    // Show what gets saved: this lead's details turned back into placeholders.
    const pv = leadVars(ctx, senderName, true);
    const preview = `${tokenize(subject, pv)}

${tokenize(body, pv)}`;
    if (!window.confirm(`It will be saved like this (the {{placeholders}} fill in for each lead):

${preview.slice(0, 900)}`)) return;
    const name = window.prompt("Name this template (it's saved with a version history):", "");
    if (!name?.trim()) return;
    setSavingTpl(true);
    // This lead's details go back to placeholders so the template fits any lead.
    const v = leadVars(ctx, senderName, true);
    const r = await fetchJson<SavedTemplate>("/api/email-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        service_key: savedId ? (saved.find((x) => x.id === savedId)?.service_key ?? null) : service === "custom" ? null : service,
        subject: tokenize(subject, v),
        body: tokenize(body, v),
        follow_up_1: followCount >= 1 ? tokenize(followUps[0], v) : "",
        follow_up_2: followCount >= 2 ? tokenize(followUps[1], v) : "",
      }),
    });
    setSavingTpl(false);
    if (!r.success) return void toast.error(r.error, { title: "Template not saved" });
    setSaved((list) => [r.data, ...list]);
    setSavedId(r.data.id);
    toast.success(`Saved as "${r.data.name}". Edit it or see its history on the Templates page.`);
  }

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetchJson<ComposeContext>(`/api/leads/${leadId}/send-email`),
      fetchJson<{ mailboxes: Mailbox[] }>("/api/email-accounts"),
      fetchJson<{ templates: SavedTemplate[] }>("/api/email-templates"),
    ]).then(([c, m, tpl]) => {
      if (!alive) return;
      const templates = tpl.success ? tpl.data.templates : [];
      if (tpl.success) setSaved(templates);
      const list = m.success ? m.data.mailboxes : [];
      setMailboxes(list);
      // Reputation leads start on an OptiRate mailbox (Ethan / Lily); everything else on the first one.
      const preferred = c.success && c.data.preferredSender ? list.find((x) => x.email === c.data.preferredSender) : undefined;
      const start = preferred ?? list[0];
      setFrom(start?.email ?? "");
      if (!c.success) {
        setLoadError(c.error);
        return;
      }
      setCtx(c.data);
      startOffer(c.data.defaultService, c.data, start?.from_name ?? null, templates);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  function pickService(value: string) {
    if (!ctx) return;
    const current = savedId ? `saved:${savedId}` : service;
    if (value === current) return;
    if (edited && !window.confirm("Replace what you wrote with the ready-made email?")) return;
    if (value.startsWith("saved:")) {
      const t = saved.find((x) => `saved:${x.id}` === value);
      if (t) fillSaved(t, ctx, senderName);
      setTest(null);
    } else startOffer(value as ServiceKey, ctx, senderName, saved);
  }

  function pickMailbox(email: string) {
    setFrom(email);
    // Re-sign the ready-made text with the new sender's name, unless the operator already changed it.
    if (ctx && !edited) refill(ctx, (mailboxes ?? []).find((m) => m.email === email)?.from_name ?? null, includeLink);
  }

  function toggleLink(next: boolean) {
    if (!ctx) return;
    if (edited && !window.confirm(next ? "Add the demo link back? This refills the email." : "Remove the demo link? This refills the email.")) return;
    setIncludeLink(next);
    refill(ctx, senderName, next);
  }

  const setSubject = (v: string) => {
    setSubjectRaw(v);
    setEdited(true);
  };
  const setBody = (v: string) => {
    setBodyRaw(v);
    setEdited(true);
    setDemoGap(false);
  };
  const setFollowUp = (i: 0 | 1, v: string) => {
    const next: [string, string] = [...followUps];
    next[i] = v;
    setFollowUps(next);
    setEdited(true);
  };

  const savedTpl = savedId ? saved.find((x) => x.id === savedId) : undefined;
  // The link switch shows for website offers and for saved templates that mention {{demo_link}}.
  const linkOffer = savedTpl
    ? usesToken([savedTpl.subject, savedTpl.body, savedTpl.follow_up_1, savedTpl.follow_up_2], "demo_link")
    : LINK_OFFERS.has(service);
  /** The offer this text was written for (saved template's offer, or the ready-made one). */
  const offerKey: string | null = savedTpl ? savedTpl.service_key : service === "custom" ? null : service;

  /** Which email this is, sent with the email for the Templates page's Results (the server adds the name). */
  const used = {
    key: savedId ? `saved:${savedId}` : `service:${service}`,
    edited,
    ...(test ? { testId: test.id, variant: test.variant } : {}),
  };

  const spam = useMemo(() => (subject.trim() && body.trim() ? spamCheck(subject, textToHtml(body)) : null), [subject, body]);
  const noMailbox = mailboxes !== null && mailboxes.length === 0;
  const chosenFollowUps = followUps.slice(0, followCount);
  const followUpsFilled = chosenFollowUps.every((f) => f.trim() !== "");
  // A {{placeholder}} still in the text (a typo, or one this lead has no value for) is never sent.
  const leftovers = leftoverTokens([subject, body, ...chosenFollowUps]);
  const dirty = edited && (subject.trim() !== "" || body.trim() !== "");
  /** Everything the shared fields need is filled and nothing would be sent half-done. */
  const textReady = !noMailbox && mailboxes !== null && subject.trim() !== "" && body.trim() !== "" && followUpsFilled && leftovers.length === 0 && !demoGap;

  return {
    ctx, loadError, mailboxes, from, senderName, service, savedId, saved, subject, body, followCount, followUps, test, used,
    chosenFollowUps, includeLink, regenerating, savingTpl, demoGap, error, setError, linkOffer, offerKey, spam, noMailbox,
    leftovers, dirty, textReady,
    setSubject, setBody, setFollowCount, setFollowUp, pickService, pickMailbox, toggleLink, regenerate, saveAsTemplate,
  };
}

export type EmailCompose = ReturnType<typeof useEmailCompose>;
