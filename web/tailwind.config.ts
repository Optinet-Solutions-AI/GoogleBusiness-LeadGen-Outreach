import type { Config } from "tailwindcss";

/**
 * tailwind.config.ts — design tokens for the editorial-confidence dashboard.
 *
 * Inputs:  none
 * Outputs: typography + color + spacing tokens consumed via Tailwind utilities
 * Used by: every component in app/ and components/
 *
 * Direction: Bloomberg control room × NYT magazine × Linear. Three fonts
 * loaded via next/font: Instrument Serif (display, italic by default),
 * Geist (body sans), Geist Mono (data + timestamps). One ember accent
 * reserved for "live"/urgent moments — never for primary chrome.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Warm cream-tinged off-white, not pure white. Reads as paper.
        canvas:       "rgb(var(--canvas)        / <alpha-value>)",
        surface:      "rgb(var(--surface)       / <alpha-value>)",
        "surface-alt":"rgb(var(--surface-alt)   / <alpha-value>)",

        // Ink — deep warm black + muted variants
        ink:           "rgb(var(--ink)           / <alpha-value>)",
        "ink-muted":   "rgb(var(--ink-muted)     / <alpha-value>)",
        "ink-subtle":  "rgb(var(--ink-subtle)    / <alpha-value>)",
        rule:          "rgb(var(--rule)          / <alpha-value>)",
        "rule-strong": "rgb(var(--rule-strong)   / <alpha-value>)",

        // Action — primary CTA / link / focus. (`ember` kept as a legacy alias.)
        action:        "rgb(var(--action)        / <alpha-value>)",
        "action-soft": "rgb(var(--action-soft)   / <alpha-value>)",
        ember:         "rgb(var(--ember)         / <alpha-value>)",
        "ember-soft":  "rgb(var(--ember-soft)    / <alpha-value>)",

        // Stage palette — desaturated, used in chips
        positive:        "rgb(var(--positive)        / <alpha-value>)",
        "positive-soft": "rgb(var(--positive-soft)   / <alpha-value>)",
        warning:         "rgb(var(--warning)         / <alpha-value>)",
        "warning-soft":  "rgb(var(--warning-soft)    / <alpha-value>)",
        urgent:          "rgb(var(--urgent)          / <alpha-value>)",
        "urgent-soft":   "rgb(var(--urgent-soft)     / <alpha-value>)",

        // ── Legacy aliases — keep old code compiling while we migrate ──
        brand: {
          DEFAULT: "rgb(var(--ink)            / <alpha-value>)",
          50:  "rgb(var(--ember-soft)         / <alpha-value>)",
          100: "rgb(var(--ember-soft)         / <alpha-value>)",
          200: "rgb(var(--ember-soft)         / <alpha-value>)",
          500: "rgb(var(--ink)                / <alpha-value>)",
          600: "rgb(var(--ink)                / <alpha-value>)",
          700: "rgb(var(--ink)                / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans:    ["var(--font-sans)",    "ui-sans-serif", "system-ui", "sans-serif"],
        mono:    ["var(--font-mono)",    "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "label-caps": ["10px", { lineHeight: "12px", letterSpacing: "0.18em", fontWeight: "600" }],
        "mono-data":  ["13px", { lineHeight: "18px" }],
        "body-sm":    ["13px", { lineHeight: "18px" }],
        "body-base":  ["14px", { lineHeight: "20px" }],
        "headline-sm":["18px", { lineHeight: "22px", letterSpacing: "-0.018em" }],
        // Editorial display numbers — used in metric cards
        "display-md": ["48px", { lineHeight: "0.92" }],
        "display-lg": ["64px", { lineHeight: "0.92" }],
        "display-xl": ["88px", { lineHeight: "0.92" }],
      },
      spacing: {
        "sidebar":  "224px",
        "topbar":   "56px",
      },
      borderRadius: {
        sm: "2px",
        DEFAULT: "4px",
        md: "6px",
        lg: "8px",
        xl: "12px",
      },
      boxShadow: {
        // Soft paper-on-paper shadow — subtle, never dramatic.
        card: "0 1px 0 rgb(var(--rule)), 0 0 0 1px rgb(var(--rule) / 0.5)",
        // Hero card (Needs You) — needs presence without going dark-on-dark
        hero: "0 24px 48px -16px rgb(17 17 15 / 0.18), 0 0 0 1px rgb(var(--rule) / 0.5)",
      },
    },
  },
  plugins: [],
};

export default config;
