import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lead-Gen Pipeline",
  description: "Operator dashboard for the local lead-gen + auto-site pipeline",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-50 text-zinc-900 antialiased">{children}</body>
    </html>
  );
}
