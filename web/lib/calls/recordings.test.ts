/**
 * recordings.test.ts — the pure rules for AI call recordings: which link, file names, states, messages, labels.
 *
 * Inputs:  Vapi-like call objects, call_attempts-like rows
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import {
  agentLabel,
  dialAgentName,
  downloadName,
  isTestCall,
  nextRecordingStep,
  pickRecordingUrl,
  recordingExt,
  recordingMessage,
  resultLabel,
  transcriptTxt,
} from "./recordings";

const now = Date.parse("2026-11-19T12:00:00Z");

describe("recordings", () => {
  it("picks the presigned link first, ignores non-https", () => {
    expect(pickRecordingUrl({ artifact: { recordingUrl: "https://b/x.wav", presignedMonoUrl: "https://a/x.mp3" } })).toBe("https://a/x.mp3");
    expect(pickRecordingUrl({ artifact: { recording: { mono: { combinedUrl: "https://c/y.wav" } } } })).toBe("https://c/y.wav");
    expect(pickRecordingUrl({ artifact: { recordingUrl: "http://insecure/x.wav" } })).toBeNull();
    expect(pickRecordingUrl(null)).toBeNull();
  });

  it("extension from content type, then url, else wav", () => {
    expect(recordingExt("https://a/x", "audio/mpeg")).toBe("mp3");
    expect(recordingExt("https://a/x.ogg?sig=1", null)).toBe("ogg");
    expect(recordingExt("https://a/x", "application/octet-stream")).toBe("wav");
  });

  it("waits for a fresh call, gives up after 13 days", () => {
    expect(nextRecordingStep({ linkFound: false, endedAt: "2026-11-19T11:00:00Z", now })).toBe("wait");
    expect(nextRecordingStep({ linkFound: false, endedAt: "2026-11-19T09:00:00Z", now })).toBe("none_at_vapi");
    expect(nextRecordingStep({ linkFound: true, endedAt: "2026-11-19T11:59:00Z", now })).toBe("download");
    expect(nextRecordingStep({ linkFound: true, endedAt: "2026-11-05T11:00:00Z", now })).toBe("lost");
  });

  it("plain messages", () => {
    const base = { recordingUrl: null, state: null, hasVapiId: true, endedAt: "2026-11-19T11:50:00Z", now, keySet: true };
    expect(recordingMessage({ ...base, recordingUrl: "abc.mp3" }).kind).toBe("ready");
    expect(recordingMessage(base).text).toBe("Recording not ready yet (fetched within 15 min of the call)");
    expect(recordingMessage({ ...base, keySet: false }).text).toBe("Recordings are off (no Vapi key)");
    expect(recordingMessage({ ...base, state: "no_access" }).text).toBe("Recordings are off: the Vapi key can't read this call");
    expect(recordingMessage({ ...base, state: "none_at_vapi" }).text).toBe("Vapi has no recording for this call");
    expect(recordingMessage({ ...base, state: "lost" }).text).toBe("Recording expired at Vapi");
    expect(recordingMessage({ ...base, endedAt: "2026-11-01T00:00:00Z" }).text).toBe("Recording expired at Vapi");
    expect(recordingMessage({ ...base, hasVapiId: false }).text).toBe("No recording for this call");
  });

  it("agent label", () => {
    expect(agentLabel({})).toBe("—");
    expect(agentLabel(null)).toBe("—");
    expect(agentLabel({ agent_name: "Reputation", voizo_campaign_id: "c1" })).toBe("Reputation");
    expect(agentLabel({ agent_name: null, voizo_campaign_id: "c1" })).toBe("c1");
    expect(agentLabel({ agent_name: null, voizo_campaign_id: null })).toBe("Voizo default");
  });

  it("test call: flag wins, else number differs from the lead's", () => {
    expect(isTestCall({ test_number: false, phone: "+639171234567" }, "(512) 555-0100", "us")).toBe(false);
    expect(isTestCall({ phone: "+639171234567" }, "(512) 555-0100", "us")).toBe(true);
    expect(isTestCall({ phone: "+15125550100" }, "(512) 555-0100", "us")).toBe(false);
    expect(isTestCall(null, "(512) 555-0100", "us")).toBe(false);
  });

  it("safe download names", () => {
    expect(downloadName("Café Zoë / Bar 🍷", "2026-11-19T10:00:00Z", "mp3")).toBe("cafe-zoe-bar-2026-11-19.mp3");
    expect(downloadName("", "2026-11-19T10:00:00Z", "wav")).toBe("call-2026-11-19.wav");
  });

  it("transcript txt has a header and says when empty", () => {
    const t = transcriptTxt({ business: "Acme", date: "2026-11-19T10:00:00Z", phone: "+15125550100", agent: "Voizo default", result: "interested", durationSec: 95, transcript: null });
    expect(t).toContain("Acme");
    expect(t).toContain("+15125550100");
    expect(t).toContain("Voizo default");
    expect(t).toContain("1 min 35 s");
    expect(t).toContain("(no transcript)");
  });

  it("result label", () => {
    expect(resultLabel({ status: "completed", outcome: "not_interested" })).toBe("not interested");
    expect(resultLabel({ status: "no_answer", outcome: null })).toBe("no answer");
  });

  it("the agent name a call records: the picked agent, else Voizo's script (Lead Gen API (shadow))", () => {
    expect(dialAgentName(null, null, "Lead Gen API (shadow)")).toBe("Lead Gen API (shadow)");
    expect(dialAgentName("c1", "Vella", "Lead Gen API (shadow)")).toBe("Vella");
    expect(dialAgentName("c1", null, "Lead Gen API (shadow)")).toBeNull();
    expect(dialAgentName(null, null, null)).toBeNull();
  });
});
