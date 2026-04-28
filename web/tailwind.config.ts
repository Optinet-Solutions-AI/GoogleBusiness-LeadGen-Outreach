import type { Config } from "tailwindcss";

/**
 * tailwind.config.ts — design tokens from the Stitch dashboard system.
 * "High-Density Functionalist" — Linear / Vercel-dashboard density. Light mode only.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Brand
        brand: {
          DEFAULT: "#1F4E79",
          50:  "#EEF4FB",
          100: "#D1E4FB",
          200: "#A0CAFC",
          500: "#1F4E79",
          600: "#184974",
          700: "#00375E",
        },
        // Surface levels (Stitch DESIGN.md tokens)
        surface: {
          DEFAULT: "#F8FAFC",
          1: "#FFFFFF",
          2: "#F1F5F9",
          dim: "#D9DADE",
        },
        ink: {
          DEFAULT: "#1A1C1F",   // on-surface
          variant: "#42474F",
          subtle:  "#72777F",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      fontSize: {
        // Stitch's compressed scale for high-density data
        "label-caps": ["12px", { lineHeight: "16px", letterSpacing: "0.05em", fontWeight: "600" }],
        "mono-data":  ["13px", { lineHeight: "18px" }],
        "body-sm":    ["13px", { lineHeight: "18px" }],
        "body-base":  ["14px", { lineHeight: "20px" }],
        "headline-sm": ["16px", { lineHeight: "24px", letterSpacing: "-0.01em", fontWeight: "600" }],
      },
      spacing: {
        "sidebar":  "240px",
        "topbar":   "48px",
        "row":      "40px",
      },
      borderRadius: {
        // Stitch convention: cards = lg (8px), pills = full
        sm: "0.125rem",
        DEFAULT: "0.375rem",
        md: "0.5rem",
        lg: "0.5rem",
        xl: "0.75rem",
      },
    },
  },
  plugins: [],
};

export default config;
