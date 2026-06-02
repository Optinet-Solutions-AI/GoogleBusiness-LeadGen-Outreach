"use client";

/**
 * AgentEditor.tsx — Edit the managed Vapi assistant's system prompt and voice settings.
 *
 * Inputs:  /api/voice/agent (GET + PATCH), /api/voice/voices (GET)
 * Outputs: updated system prompt + full voice config on save (via PATCH)
 * Used by: app/(dashboard)/test-call/page.tsx
 */

import { useEffect, useState } from "react";

interface VoiceOption {
  provider: string;
  voiceId: string;
  label: string;
}

interface AgentVoice {
  provider: string | null;
  voiceId: string | null;
  model: string | null;
  stability: number | null;
  similarityBoost: number | null;
  speed: number | null;
}

interface AgentInfo {
  id: string;
  name: string | null;
  systemPrompt: string;
  voice: AgentVoice;
}

type SaveState = "idle" | "saving" | "saved" | "error";
type ApplyState = "idle" | "applying" | "applied" | "error";

const VOICE_MODELS = [
  { value: "eleven_multilingual_v2", label: "Multilingual v2 (best quality)" },
  { value: "eleven_turbo_v2_5", label: "Turbo v2.5 (fast, multilingual)" },
  { value: "eleven_turbo_v2", label: "Turbo v2 (fast, English)" },
  { value: "eleven_flash_v2_5", label: "Flash v2.5 (fastest)" },
  { value: "eleven_monolingual_v1", label: "Monolingual v1 (English classic)" },
];

function SliderRow({
  label,
  sublabel,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  sublabel?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[12px] font-medium text-ink">{label}</label>
        <span className="text-[12px] font-mono text-ink-muted tabular-nums">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-action h-1.5 cursor-pointer"
      />
      {sublabel && (
        <div className="flex justify-between mt-0.5">
          <span className="text-[11px] text-ink-subtle">{sublabel.split("←")[0].trim()}</span>
          <span className="text-[11px] text-ink-subtle">{sublabel.split("→")[1]?.trim()}</span>
        </div>
      )}
    </div>
  );
}

export function AgentEditor() {
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  // System prompt state
  const [systemPrompt, setSystemPrompt] = useState("");

  // Voice config state
  const [voiceId, setVoiceId] = useState("");
  const [voiceModel, setVoiceModel] = useState("eleven_multilingual_v2");
  const [stability, setStability] = useState(0.5);
  const [similarityBoost, setSimilarityBoost] = useState(0.8);
  const [speed, setSpeed] = useState(1.0);

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

          // Seed voice config from agent data
          setVoiceId(agentData.voice.voiceId ?? "");
          setVoiceModel(agentData.voice.model ?? "eleven_multilingual_v2");
          setStability(agentData.voice.stability ?? 0.5);
          setSimilarityBoost(agentData.voice.similarityBoost ?? 0.8);
          setSpeed(agentData.voice.speed ?? 1.0);

          // Ensure current voice is in the quick-pick list even if not returned
          const currentId = agentData.voice.voiceId;
          const currentProvider = agentData.voice.provider;
          if (currentId && currentProvider) {
            const inList = voiceList.some((v) => v.voiceId === currentId && v.provider === currentProvider);
            if (!inList) {
              voiceList.push({
                provider: currentProvider,
                voiceId: currentId,
                label: `${currentProvider} · ${String(currentId).slice(0, 10)}…`,
              });
            }
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

  function markDirty() {
    setSaveState("idle");
  }

  async function handleSave() {
    setSaveState("saving");
    setSaveError(null);

    try {
      const res = await fetch("/api/voice/agent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt,
          voice: {
            voiceId: voiceId.trim() || undefined,
            model: voiceModel,
            stability,
            similarityBoost,
            speed,
          },
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
              markDirty();
            }}
            spellCheck={false}
          />
        </div>

        {/* ── Voice configuration ───────────────────────────────────────── */}
        <div className="space-y-4">
          <h3 className="text-[13px] font-semibold text-ink border-b border-rule pb-2">
            Voice
          </h3>

          {/* Voice ID + quick pick */}
          <div>
            <label className="block text-[12px] font-medium text-ink mb-1">
              Voice ID
            </label>
            <input
              type="text"
              className="w-full rounded border border-rule bg-canvas text-ink text-[13px] px-3 py-2 focus:outline-none focus:ring-1 focus:ring-action font-mono"
              placeholder="Paste an ElevenLabs voice ID"
              value={voiceId}
              onChange={(e) => {
                setVoiceId(e.target.value);
                markDirty();
              }}
            />
            {voices.length > 0 && (
              <div className="mt-1.5">
                <label className="block text-[11px] text-ink-subtle mb-1">
                  Quick pick from your existing voices
                </label>
                <select
                  className="rounded border border-rule bg-canvas text-ink text-[12px] px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-action"
                  value={voices.find((v) => v.voiceId === voiceId)?.voiceId ?? ""}
                  onChange={(e) => {
                    if (e.target.value) {
                      setVoiceId(e.target.value);
                      markDirty();
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

          {/* Voice model */}
          <div>
            <label className="block text-[12px] font-medium text-ink mb-1">
              Voice model
            </label>
            <select
              className="rounded border border-rule bg-canvas text-ink text-[13px] px-3 py-2 focus:outline-none focus:ring-1 focus:ring-action"
              value={voiceModel}
              onChange={(e) => {
                setVoiceModel(e.target.value);
                markDirty();
              }}
            >
              {VOICE_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Stability */}
          <SliderRow
            label="Stability"
            sublabel="more variable ← → more stable"
            value={stability}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => {
              setStability(v);
              markDirty();
            }}
          />

          {/* Clarity + similarity */}
          <SliderRow
            label="Clarity + similarity"
            sublabel="less similar ← → clearer &amp; more similar"
            value={similarityBoost}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => {
              setSimilarityBoost(v);
              markDirty();
            }}
          />

          {/* Speed */}
          <SliderRow
            label="Speed"
            sublabel="slower ← → faster"
            value={speed}
            min={0.25}
            max={2}
            step={0.05}
            onChange={(v) => {
              setSpeed(v);
              markDirty();
            }}
          />
        </div>

        {/* Save (primary) + Reset-to-recommended (secondary) */}
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
