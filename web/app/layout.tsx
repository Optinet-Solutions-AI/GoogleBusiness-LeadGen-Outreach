import type { Metadata } from "next";
import { Sora, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Display — Sora at heavy weights for confident dashboard numbers + headlines.
// Geometric, technical, NOT romantic. Replaces the previous italic-serif which
// read as "wedding invitation" rather than "operations dashboard".
const display = Sora({
  weight: ["500", "600", "700", "800"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

// Body — Inter. Yes, "boring", but it's what every operational dashboard uses
// for a reason: rational, readable at small sizes, no character that fights
// the data. Sora carries the personality at display sizes.
const sans = Inter({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lead-Gen Pipeline",
  description: "Operator dashboard for the local lead-gen + auto-site pipeline",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="bg-canvas text-ink antialiased font-sans">{children}</body>
    </html>
  );
}
