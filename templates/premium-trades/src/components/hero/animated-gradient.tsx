/**
 * animated-gradient.tsx — Hero variant for low-photo leads.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: full-bleed hero with mesh-gradient bg, animated grain overlay,
 *          headline, subhead, dual CTAs, and a floating stat card.
 * Used by: pages/index.astro when variants.hero === 'animated-gradient'
 */
import { motion } from "framer-motion";
import { Phone, Star } from "lucide-react";
import type { SiteData } from "../../lib/data";
import { telHref } from "../../lib/format";

export default function AnimatedGradientHero({ data }: { data: SiteData }) {
  const c = data.copy;
  const rating = data.rating;
  const reviews = data.review_count;
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-surface" />
      <div
        className="absolute inset-0 -z-10 opacity-90"
        style={{
          background:
            "radial-gradient(60% 60% at 20% 30%, rgb(var(--c-primary)) 0%, transparent 60%)," +
            "radial-gradient(50% 50% at 85% 20%, rgb(var(--c-accent)) 0%, transparent 55%)," +
            "radial-gradient(55% 55% at 70% 90%, rgb(var(--c-primary)) 0%, transparent 60%)",
        }}
      />
      <motion.div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-[0.08] mix-blend-overlay"
        animate={{ backgroundPosition: ["0% 0%", "100% 100%"] }}
        transition={{ duration: 22, repeat: Infinity, repeatType: "reverse", ease: "linear" }}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/></svg>\")",
          backgroundSize: "240px 240px",
        }}
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-surface/0 via-surface/0 to-surface" />

      <div className="container-tight pt-20 pb-32 md:pt-32 md:pb-44">
        <motion.span
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="eyebrow"
        >
          {data.category ?? "Local Service"} · {data.address?.split(",").slice(-2, -1)[0]?.trim() ?? "Local"}
        </motion.span>

        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="mt-4 text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tighter-2 leading-tight-2 text-ink max-w-4xl"
        >
          {c.hero_tagline}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.12 }}
          className="mt-6 max-w-2xl text-lg md:text-xl text-ink-muted leading-relaxed"
        >
          {c.hero_subhead}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-10 flex flex-wrap items-center gap-3"
        >
          <a href="/contact" className="btn-primary text-base">
            {c.cta_primary}
          </a>
          {data.phone && (
            <a href={telHref(data.phone)} className="btn-secondary text-base">
              <Phone size={16} aria-hidden /> {c.cta_secondary}
            </a>
          )}
          <span className="ml-1 text-sm text-ink-muted">{c.urgency_micro}</span>
        </motion.div>

        {(rating || reviews) && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.32 }}
            className="mt-14 inline-flex items-center gap-4 rounded-2xl bg-surface/80 backdrop-blur border border-ink/5 shadow-xl shadow-ink/5 px-5 py-4"
          >
            <div className="flex">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  size={18}
                  className="text-amber-400"
                  fill="currentColor"
                  strokeWidth={0}
                />
              ))}
            </div>
            <div className="text-sm">
              <div className="font-semibold text-ink">
                {rating?.toFixed(1) ?? "5.0"} on Google
              </div>
              <div className="text-ink-muted">{c.social_proof_line}</div>
            </div>
          </motion.div>
        )}
      </div>
    </section>
  );
}
