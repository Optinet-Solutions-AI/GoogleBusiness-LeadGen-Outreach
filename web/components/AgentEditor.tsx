"use client";

/**
 * AgentEditor.tsx — Edit the managed Vapi assistant's system prompt + voice.
 *
 * Inputs:  /api/voice/agent (GET + PATCH), /api/voice/voices (GET)
 * Outputs: updated system prompt + voice id on save (via PATCH)
 * Used by: app/(dashboard)/test-call/page.tsx
 *
 * Kept deliberately simple: a prompt box + a voice id (provider is always 11labs,
 * set server-side). The prompt does the heavy lifting; voice fine-tuning lives in Vapi.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

interface VoiceOption {
  provider: string;
  voiceId: string;
  label: string;
}

interface AgentInfo {
  id: string;
  name: string | null;
  firstMessage: string;
  systemPrompt: string;
  voice: { provider: string | null; voiceId: string | null };
}

type SaveState = "idle" | "saving" | "saved" | "error";
type ApplyState = "idle" | "applying" | "applied" | "error";

export function AgentEditor() {
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  const [firstMessage, setFirstMessage] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [voiceId, setVoiceId] = useState("");

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [applyState, setApplyState] = useState<ApplyState>("idle");
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [agentRes, voicesRes] = await Promise.all([
          fetch("/api/voice/agent"),
          fetch("/api/voice/voices"),
        ]);

        if (agentRes.status === 503) {
          if (!cancelled) setNotConfigured(true);
          return;
        }

        const agentJson = await agentRes.json();
        const voicesJson = await voicesRes.json();

        if (!agentJson.success) {
          if (!cancelled) setLoadError(agentJson.error ?? "Failed to load agent");
          return;
        }

        const agentData: AgentInfo = agentJson.data;
        const voiceList: VoiceOption[] = voicesJson.success ? (voicesJson.data?.voices ?? []) : [];

        if (!cancelled) {
          setAgent(agentData);
          setFirstMessage(agentData.firstMessage ?? "");
          setSystemPrompt(agentData.systemPrompt);
          setVoiceId(agentData.voice.voiceId ?? "");

          // Make sure the current voice is selectable in the quick-pick.
          const currentId = agentData.voice.voiceId;
          const currentProvider = agentData.voice.provider;
          if (currentId && currentProvider && !voiceList.some((v) => v.voiceId === currentId)) {
            voiceList.push({
              provider: currentProvider,
              voiceId: currentId,
              label: `${currentProvider} · ${String(currentId).slice(0, 10)}…`,
            });
          }
          setVoices(voiceList);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setSaveState("saving");
    setSaveError(null);
    try {
      const res = await fetch("/api/voice/agent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstMessage,
          systemPrompt,
          voice: { voiceId: voiceId.trim() || undefined },
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setSaveState("error");
        setSaveError(json.error ?? "Save failed");
        return;
      }
      setSaveState("saved");
    } catch (e) {
      setSaveState("error");
      setSaveError(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function handleApply() {
    setApplyState("applying");
    setApplyError(null);
    try {
      const res = await fetch("/api/voice/agent/apply", { method: "POST" });
      const json = await res.json();
      if (!json.success) {
        setApplyState("error");
        setApplyError(json.error ?? "Reset failed");
        return;
      }
      const refreshed = await (await fetch("/api/voice/agent")).json();
      if (refreshed.success) {
        setSystemPrompt(refreshed.data.systemPrompt);
        setFirstMessage(refreshed.data.firstMessage ?? "");
      }
      setApplyState("applied");
      setSaveState("idle");
    } catch (e) {
      setApplyState("error");
      setApplyError(e instanceof Error ? e.message : "Reset failed");
    }
  }

  if (notConfigured) {
    return (
      <div className="bg-surface border border-rule rounded-lg p-6 text-[13px] text-ink-muted mb-6">
        Set <code className="font-mono text-ink">VAPI_API_KEY</code>
        {" + "}
        <code className="font-mono text-ink">VAPI_AGENT_ID</code> then restart the server to enable the agent editor.
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="bg-surface border border-rule rounded-lg p-6 text-[13px] text-urgent mb-6">
        Could not load agent: {loadError}
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="bg-surface border border-rule rounded-lg p-6 text-[13px] text-ink-muted mb-6 animate-pulse">
        Loading agent…
      </div>
    );
  }

  return (
    <div className="bg-surface border border-rule rounded-lg overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-rule flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">Agent prompt &amp; voice</h2>
          <p className="text-[12px] text-ink-muted mt-0.5">
            You&apos;re editing the test agent &mdash; your live/production agents aren&apos;t affected.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={handleApply}
              disabled={applyState === "applying"}
              className="text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink transition-colors disabled:opacity-50 bg-transparent border-0 p-0 cursor-pointer"
            >
              {applyState === "applying" ? "Resetting…" : "Reset to recommended"}
            </button>
            <Button onClick={handleSave} loading={saveState === "saving"}>
              {saveState === "saving" ? "Saving…" : "Save"}
            </Button>
          </div>
          <div className="h-4 text-right">
            {saveState === "saved" && <span className="text-[12px] text-positive">Saved &mdash; test it on the right.</span>}
            {saveState === "error" && <span className="text-[12px] text-urgent">{saveError ?? "Save failed"}</span>}
            {applyState === "applied" && <span className="text-[12px] text-positive">Reset to recommended.</span>}
            {applyState === "error" && <span className="text-[12px] text-urgent">{applyError ?? "Reset failed"}</span>}
          </div>
        </div>
      </div>

      <div className="px-5 py-5 space-y-5">
        {/* First message (the intro the agent says first) */}
        <div>
          <label className="block text-[12px] font-medium text-ink mb-1.5">
            First message <span className="text-ink-subtle font-normal">(the opener it says first)</span>
          </label>
          <textarea
            className="w-full rounded border border-rule bg-canvas text-ink text-[13px] leading-[1.5] p-3 resize-y focus:outline-none focus:ring-1 focus:ring-action"
            rows={3}
            value={firstMessage}
            onChange={(e) => {
              setFirstMessage(e.target.value);
              setSaveState("idle");
            }}
            placeholder="Hey, this is Sam — I'll keep it quick…"
          />
          <p className="text-[11px] text-ink-subtle mt-1">
            This is spoken before the prospect says anything — front-load who you are, why you&apos;re calling, and the ask so a quick hang-up still hears the point.
          </p>
        </div>

        {/* System prompt */}
        <div>
          <label className="block text-[12px] font-medium text-ink mb-1.5">System prompt</label>
          <textarea
            className="w-full rounded border border-rule bg-canvas text-ink text-[13px] font-mono leading-[1.55] p-3 resize-y focus:outline-none focus:ring-1 focus:ring-action"
            rows={12}
            value={systemPrompt}
            onChange={(e) => {
              setSystemPrompt(e.target.value);
              setSaveState("idle");
            }}
            spellCheck={false}
          />
        </div>

        {/* Voice */}
        <div>
          <label className="block text-[12px] font-medium text-ink mb-1.5">Voice</label>
          <input
            type="text"
            className="w-full rounded border border-rule bg-canvas text-ink text-[13px] px-3 py-2 font-mono focus:outline-none focus:ring-1 focus:ring-action"
            placeholder="Paste a voice ID (from Vapi)"
            value={voiceId}
            onChange={(e) => {
              setVoiceId(e.target.value);
              setSaveState("idle");
            }}
          />
          {voices.length > 0 && (
            <div className="mt-1.5">
              <label className="block text-[11px] text-ink-subtle mb-1">Or pick one you already use</label>
              <select
                className="rounded border border-rule bg-canvas text-ink text-[12px] px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-action"
                value={voices.find((v) => v.voiceId === voiceId)?.voiceId ?? ""}
                onChange={(e) => {
                  if (e.target.value) {
                    setVoiceId(e.target.value);
                    setSaveState("idle");
                  }
                }}
              >
                <option value="">— pick a voice —</option>
                {voices.map((v) => (
                  <option key={`${v.provider}|${v.voiceId}`} value={v.voiceId}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <p className="text-[11.5px] text-ink-subtle">
          <strong className="font-medium text-ink-muted">Save</strong> (top right) writes your changes to the agent.
          &ldquo;Reset to recommended&rdquo; puts back our suggested version if an edit didn&apos;t work out.
        </p>
      </div>
    </div>
  );
}
