/**
 * assistant/useSpeech.ts — voice typing for the assistant with Chrome's built-in Google speech recognition.
 *
 * Inputs:  lang ("en-US" | "he-IL"), onText(finalText, interimText) callback
 * Outputs: { supported, listening, error, start, stop }
 * Used by: components/assistant/AssistantWidget.tsx
 *
 * Chrome's Web Speech API sends the audio to Google's speech service — free, no key, good with accents and Hebrew.
 * One language per session, so the panel has an English / Hebrew switch. Firefox has no speech recognition:
 * `supported` is false there and the mic button explains it. The browser asks for the microphone once; choosing
 * "Allow on every visit" keeps it allowed (the site also sends Permissions-Policy: microphone=(self)).
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Result = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<Result> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed":
    "The microphone is blocked. Click the icon left of the web address → Microphone → Allow, then reload the page.",
  "service-not-allowed": "Chrome's voice service is turned off for this site. Allow the microphone and reload.",
  "no-speech": "I didn't hear anything. Click the mic and speak again.",
  "audio-capture": "No microphone found. Check that one is plugged in and selected.",
  network: "Voice typing needs an internet connection to Google's speech service.",
  "language-not-supported": "This browser can't recognise that language. Try the other language or use Chrome.",
};

export function useSpeech(lang: string, onText: (finalText: string, interim: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => {
    setSupported(getCtor() !== null);
    return () => rec.current?.abort();
  }, []);

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    rec.current?.abort();
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let finalText = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      cb.current(finalText.trim(), interim.trim());
    };
    r.onerror = (e) => {
      if (e.error !== "aborted") setError(ERRORS[e.error] ?? `Voice typing stopped (${e.error}).`);
    };
    r.onend = () => setListening(false);
    rec.current = r;
    setError(null);
    try {
      r.start();
      setListening(true);
    } catch {
      setError("Couldn't start the microphone. Reload the page and try again.");
    }
  }, [lang]);

  return { supported, listening, error, start, stop };
}
