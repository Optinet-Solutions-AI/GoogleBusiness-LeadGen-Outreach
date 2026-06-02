"use client";

/**
 * AgentEditor.tsx — Edit the managed Vapi assistant's system prompt and voice.
 *
 * Inputs:  /api/voice/agent (GET + PATCH), /api/voice/voices (GET)
 * Outputs: updated system prompt + voice on save (via PATCH)
 * Used by: app/(dashboard)/test-call/page.tsx
 */

import { useEffect, useState } from "react";

interface VoiceOption {
  provider: string;
  voiceId: string;
  label: string;
}

interface AgentInfo {
  id: string;
  name: string | null;
  systemPrompt: string;
  voice: { provider: string | null; voiceId: string | null };
}

type SaveState = "idle" | "saving" | "saved" | "error";
type ApplyState = "idle" | "applying" | "applied" | "error";

function voiceKey(provider: string | null, voiceId: string | null): string {
  if (!provider || !voiceId) return "";
  return `${provider}|${voiceId}`;
}

export function AgentEditor() {
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  const [systemPrompt, setSystemPrompt] = useState("");
  const [selectedVoice, setSelectedVoice] = useState("");

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
          setSystemPrompt(agentData.systemPrompt);

          // Include current voice even if it is not in the list
          const currentKey = voiceKey(agentData.voice.provider, agentData.voice.voiceId);
          const inList = voiceList.some(
            (v) => voiceKey(v.provider, v.voiceId) === currentKey,
          );
          if (currentKey && !inList && agentData.voice.provider && agentData.voice.voiceId) {
            voiceList.push({
              provider: agentData.voice.provider,
              voiceId: agentData.voice.voiceId,
              label: `${agentData.voice.provider} · ${String(agentData.voice.voiceId).slice(0, 10)}…`,
            });
          }

          setVoices(voiceList);
          setSelectedVoice(currentKey);
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

    const [voiceProvider, voiceId] = selectedVoice.includes("|")
      ? selectedVoice.split("|")
      : ["", ""];

    try {
      const res = await fetch("/api/voice/agent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt,
          ...(voiceProvider && voiceId ? { voiceProvider, voiceId } : {}),
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
        setApplyError(json.error ?? "Apply failed");
        return;
      }
      // Reload so the editor shows the now-live (backend) prompt.
      const refreshed = await (await fetch("/api/voice/agent")).json();
      if (refreshed.success) setSystemPrompt(refreshed.data.systemPrompt);
      setApplyState("applied");
      setSaveState("idle");
    } catch (e) {
      setApplyState("error");
      setApplyError(e instanceof Error ? e.message : "Apply failed");
    }
  }

  if (notConfigured) {
    return (
      <div className="bg-surface border border-rule rounded-lg p-6 text-[13px] text-ink-muted mb-6">
        Set{" "}
        <code className="font-mono text-ink">VAPI_API_KEY</code>
        {" + "}
        <code className="font-mono text-ink">VAPI_AGENT_ID</code>{" "}
        then restart the server to enable the agent editor.
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
      <div className="px-5 py-4 border-b border-rule">
        <h2 className="text-[15px] font-semibold text-ink">Agent prompt &amp; voice</h2>
        <p className="text-[12px] text-ink-muted mt-0.5">
          You&apos;re editing the test agent &mdash; your live/production agents aren&apos;t affected.
        </p>
      </div>

      <div className="px-5 py-5 space-y-5">
        {/* System prompt */}
        <div>
          <label className="block text-[12px] font-medium text-ink mb-1.5">
            System prompt
          </label>
          <textarea
            className="w-full rounded border border-rule bg-canvas text-ink text-[13px] font-mono leading-[1.55] p-3 resize-y focus:outline-none focus:ring-1 focus:ring-action"
            rows={16}
            value={systemPrompt}
            onChange={(e) => {
              setSystemPrompt(e.target.value);
              setSaveState("idle");
            }}
            spellCheck={false}
          />
        </div>

        {/* Voice picker */}
        <div>
          <label className="block text-[12px] font-medium text-ink mb-1.5">
            Voice
          </label>
          {voices.length === 0 ? (
            <p className="text-[12px] text-ink-muted">
              No voices found in account — add at least one Vapi assistant with a voice configured.
            </p>
          ) : (
            <select
              className="rounded border border-rule bg-canvas text-ink text-[13px] px-3 py-2 focus:outline-none focus:ring-1 focus:ring-action"
              value={selectedVoice}
              onChange={(e) => {
                setSelectedVoice(e.target.value);
                setSaveState("idle");
              }}
            >
              {voices.map((v) => (
                <option key={voiceKey(v.provider, v.voiceId)} value={voiceKey(v.provider, v.voiceId)}>
                  {v.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Save (primary) + Reset to recommended (secondary) */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saveState === "saving"}
            className="px-4 py-2 rounded bg-action text-white text-[13px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saveState === "saving" ? "Saving…" : "Save"}
          </button>
          <button
            onClick={handleApply}
            disabled={applyState === "applying"}
            className="text-[13px] text-ink-muted underline underline-offset-2 hover:text-ink transition-colors disabled:opacity-50 bg-transparent border-0 p-0 cursor-pointer"
          >
            {applyState === "applying" ? "Resetting…" : "Reset to recommended"}
          </button>

          {saveState === "saved" && (
            <span className="text-[13px] text-positive">Saved. Hit Start test call below to hear it.</span>
          )}
          {saveState === "error" && (
            <span className="text-[13px] text-urgent">{saveError ?? "Save failed"}</span>
          )}
          {applyState === "applied" && (
            <span className="text-[13px] text-positive">Reset to the recommended version.</span>
          )}
          {applyState === "error" && (
            <span className="text-[13px] text-urgent">{applyError ?? "Reset failed"}</span>
          )}
        </div>
        <p className="text-[11.5px] text-ink-subtle">
          Save updates the agent. &ldquo;Reset to recommended&rdquo; puts back our suggested version if an edit didn&apos;t work out.
        </p>
      </div>
    </div>
  );
}
