/**
 * sticky-bar.tsx — Bottom-of-screen CTA bar that appears after the user has
 * scrolled past the hero. Mobile + desktop. Dismissible.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: fixed-bottom bar with phone + primary CTA. Shows after 800px scroll,
 *          remembers dismissal in sessionStorage so it doesn't nag on refresh.
 * Used by: layouts/Base.astro (rendered globally)
 */
import { AnimatePresence, motion } from "framer-motion";
import { Phone, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { SiteData } from "../../lib/data";
import { telHref } from "../../lib/format";

export default function StickyBar({ data }: { data: SiteData }) {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem("cta_dismissed") === "1") {
      setDismissed(true);
      return;
    }
    const onScroll = () => setVisible(window.scrollY > 800);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    window.sessionStorage.setItem("cta_dismissed", "1");
    setDismissed(true);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl"
          role="region"
          aria-label="Quick contact"
        >
          <div className="flex items-center gap-3 bg-ink text-white rounded-2xl shadow-2xl shadow-ink/30 pl-5 pr-2 py-2.5">
            <div className="hidden sm:block grid place-items-center w-9 h-9 rounded-full bg-brand">
              <Phone size={16} className="text-brand-text" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{data.copy.urgency_micro}</div>
              <div className="text-xs text-white/60 truncate">{data.copy.social_proof_line}</div>
            </div>
            {data.phone && (
              <a
                href={telHref(data.phone)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-brand-text font-semibold text-sm hover:brightness-110 transition"
              >
                <Phone size={14} />
                <span className="hidden sm:inline">{data.phone}</span>
                <span className="sm:hidden">Call</span>
              </a>
            )}
            <a
              href="/contact"
              className="hidden md:inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-sm transition"
            >
              {data.copy.cta_primary}
            </a>
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              className="grid place-items-center w-8 h-8 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition"
            >
              <X size={16} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
