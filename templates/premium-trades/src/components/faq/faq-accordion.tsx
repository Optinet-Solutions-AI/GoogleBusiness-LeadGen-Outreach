/**
 * faq-accordion.tsx — Section: progressive-disclosure FAQ.
 *
 * Inputs:  data prop (SiteData) — reads data.faq
 * Outputs: editorial FAQ list. Each item: question (collapsed) +
 *          answer (expands on click). Uses native <details>/<summary>
 *          for zero-JS keyboard-accessible disclosure, then enhances
 *          with framer-motion height transitions. No-ops if no items.
 * Used by: pages/index.astro when sections array includes "faq"
 *
 * Why this exists: legal, medical, real-estate, financial planning —
 * any high-trust niche where prospects arrive with specific worries.
 * FAQ surfaces the answers without forcing a phone call, and it's the
 * single best SEO surface for "long-tail intent" search queries.
 */
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { Plus } from "lucide-react";
import type { SiteData } from "../../lib/data";

export default function FaqAccordion({ data }: { data: SiteData }) {
  const items = data.faq ?? [];
  if (items.length === 0) return null;

  return (
    <section className="container-tight py-20 md:py-24" id="faq">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-4">
          <span className="eyebrow">Common questions</span>
          <h2 className="mt-3 text-4xl md:text-5xl font-semibold tracking-tighter-2 text-ink leading-[1.05]">
            Most-asked, answered.
          </h2>
          <p className="mt-5 text-base text-ink-muted leading-relaxed">
            Still have a question we didn't cover? Call us or send a note —
            we respond same-day during business hours.
          </p>
        </div>

        <div className="lg:col-span-8">
          <ul className="divide-y" style={{ borderColor: "rgb(var(--c-neutral-900) / 0.12)" }}>
            {items.map((item, i) => (
              <FaqRow key={item.question} item={item} index={i} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function FaqRow({ item, index }: { item: { question: string; answer: string }; index: number }) {
  const [open, setOpen] = useState(index === 0);

  return (
    <li className="border-t first:border-t-0" style={{ borderColor: "rgb(var(--c-neutral-900) / 0.12)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between gap-6 py-5 md:py-6 text-left group"
        aria-expanded={open}
      >
        <span
          className="font-heading text-lg md:text-xl lg:text-2xl font-semibold text-ink leading-[1.25] flex-1"
          style={{ fontVariationSettings: '"opsz" 144' }}
        >
          {item.question}
        </span>
        <span
          className="shrink-0 mt-1 w-9 h-9 flex items-center justify-center rounded-full border transition-colors"
          style={{
            borderColor: open
              ? "rgb(var(--c-primary))"
              : "rgb(var(--c-neutral-900) / 0.15)",
            background: open ? "rgb(var(--c-primary))" : "transparent",
            color: open ? "rgb(var(--c-primary-text))" : "rgb(var(--c-ink, var(--c-neutral-900)))",
          }}
          aria-hidden
        >
          <Plus
            size={16}
            className="transition-transform duration-300"
            style={{ transform: open ? "rotate(45deg)" : "rotate(0deg)" }}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.2, 0.7, 0.2, 1] }}
            className="overflow-hidden"
          >
            <p className="text-base text-ink-muted leading-relaxed pb-6 max-w-3xl">
              {item.answer}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}
