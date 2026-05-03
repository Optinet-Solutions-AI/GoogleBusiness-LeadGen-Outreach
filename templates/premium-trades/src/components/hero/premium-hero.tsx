/**
 * premium-hero.tsx — Hero variant: Aceternity-style animated blob mesh.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: full-viewport hero with 5 brand-color radial blob layers drifting
 *          on independent timers, 18 vertical glass-strip overlay shimmers,
 *          word-by-word title reveal, fade-in subhead, dual CTAs,
 *          rating chip. Optional faint background photo behind the blobs
 *          for niche-appropriate texture.
 * Used by: pages/index.astro when variants.hero === 'premium-hero'
 *
 * Adapted from 21st.dev "GlassRefractionHero" by request — replaced
 * hardcoded blue with brand palette CSS vars, swapped buttons for our
 * btn-primary / btn-secondary patterns, added rating chip + phone CTA
 * required by local-business pages, dropped the demo title-words split
 * into a real per-word stagger over data.copy.hero_tagline.
 */
import { motion } from "framer-motion";
import { Phone, Star, ArrowRight } from "lucide-react";
import type { SiteData } from "../../lib/data";
import { telHref } from "../../lib/format";

function cn(...classes: (string | undefined | false)[]): string {
  return classes.filter(Boolean).join(" ");
}

export default function PremiumHero({ data }: { data: SiteData }) {
  const c = data.copy;
  const heroImg = data.photos[0];
  const titleWords = c.hero_tagline.split(/\s+/);

  return (
    <section
      className="relative w-full min-h-[680px] md:min-h-[760px] flex items-center justify-center overflow-hidden bg-ink"
      role="banner"
      aria-label="Hero"
    >
      {/* Optional faint background photo for niche-appropriate texture.
          Sits beneath everything so blobs + glass strips do the heavy
          visual lift; the photo is just a subtle anchor. */}
      {heroImg && (
        <img
          src={heroImg}
          alt=""
          width={2400}
          height={1600}
          fetchPriority="high"
          decoding="sync"
          className="absolute inset-0 w-full h-full object-cover opacity-30"
        />
      )}

      {/* ── Animated brand-color blob mesh ───────────────────────────── */}
      <div className="absolute inset-0" aria-hidden>
        {/* Blob 1 — top-left, primary, U-shaped drift */}
        <motion.div
          className="absolute rounded-full"
          style={{
            width: "min(620px, 42vw)",
            height: "min(620px, 42vw)",
            left: "calc(-90px + 5vw)",
            top: "calc(420px - 10vh)",
            background:
              "radial-gradient(circle, rgb(var(--c-primary)) 0%, rgb(var(--c-primary) / 0.6) 50%, transparent 100%)",
            filter: "blur(140px)",
          }}
          animate={{
            x: [0, 50, 100, 50, 0],
            y: [0, -80, 0, 80, 0],
            scale: [1, 1.2, 1.4, 1.2, 1],
            rotate: [0, 90, 180, 270, 360],
          }}
          transition={{ duration: 28, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Blob 2 — center-left, accent, inverted-U */}
        <motion.div
          className="absolute rounded-full"
          style={{
            width: "min(620px, 42vw)",
            height: "min(620px, 42vw)",
            left: "calc(420px - 5vw)",
            top: "calc(600px - 20vh)",
            background:
              "radial-gradient(circle, rgb(var(--c-accent)) 0%, rgb(var(--c-accent) / 0.6) 50%, transparent 100%)",
            filter: "blur(140px)",
          }}
          animate={{
            x: [0, -60, -120, -60, 0],
            y: [0, 90, 0, -90, 0],
            scale: [1, 1.3, 1.5, 1.3, 1],
            rotate: [0, -90, -180, -270, -360],
          }}
          transition={{ duration: 32, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Blob 3 — center-right, primary, U-shaped */}
        <motion.div
          className="absolute rounded-full"
          style={{
            width: "min(620px, 42vw)",
            height: "min(620px, 42vw)",
            left: "calc(900px - 15vw)",
            top: "calc(640px - 20vh)",
            background:
              "radial-gradient(circle, rgb(var(--c-primary)) 0%, rgb(var(--c-primary) / 0.6) 50%, transparent 100%)",
            filter: "blur(140px)",
          }}
          animate={{
            x: [0, 70, 140, 70, 0],
            y: [0, -100, 0, 100, 0],
            scale: [1, 1.25, 1.45, 1.25, 1],
            rotate: [0, 120, 240, 120, 360],
          }}
          transition={{ duration: 30, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Blob 4 — top-right, accent, inverted-U */}
        <motion.div
          className="absolute rounded-full"
          style={{
            width: "min(620px, 42vw)",
            height: "min(620px, 42vw)",
            right: "calc(-200px + 10vw)",
            top: "calc(320px - 10vh)",
            background:
              "radial-gradient(circle, rgb(var(--c-accent)) 0%, rgb(var(--c-accent) / 0.6) 50%, transparent 100%)",
            filter: "blur(140px)",
          }}
          animate={{
            x: [0, -80, -160, -80, 0],
            y: [0, 110, 0, -110, 0],
            scale: [1, 1.35, 1.5, 1.35, 1],
            rotate: [0, -120, -240, -120, -360],
          }}
          transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Center glow — pulsing */}
        <motion.div
          className="absolute rounded-full"
          style={{
            width: "min(420px, 32vw)",
            height: "min(420px, 32vw)",
            left: "50%",
            top: "50%",
            background:
              "radial-gradient(circle, rgb(var(--c-primary) / 0.4) 0%, rgb(var(--c-primary) / 0.2) 100%)",
            filter: "blur(120px)",
            transform: "translate(-50%, -50%)",
          }}
          animate={{
            x: [0, 40, 80, 40, 0],
            y: [0, -60, 0, 60, 0],
            scale: [1, 1.3, 1.6, 1.3, 1],
            opacity: [0.3, 0.5, 0.7, 0.5, 0.3],
            rotate: [0, 180, 360],
          }}
          transition={{ duration: 24, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {/* ── Vertical glass-strip overlay (refraction shimmer) ───────── */}
      <div
        className="absolute inset-0 flex flex-row items-center pointer-events-none"
        aria-hidden
      >
        {Array.from({ length: 18 }).map((_, i) => (
          <motion.div
            key={i}
            className="h-full flex-shrink-0"
            style={{
              width: "calc(100vw / 18)",
              minWidth: "60px",
              maxWidth: "100px",
              background:
                "linear-gradient(90deg, rgba(217,217,217,0) 0%, rgba(0,0,0,0.55) 76%, rgba(255,255,255,0.25) 100%)",
              mixBlendMode: "overlay",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.4, 0.7, 0.4] }}
            transition={{
              duration: 4,
              delay: i * 0.1,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>

      {/* Final dark scrim — boosts text legibility independent of palette */}
      <div className="absolute inset-0 bg-ink/35" aria-hidden />

      {/* ── Content ─────────────────────────────────────────────────── */}
      <div className="relative z-10 container-tight w-full text-center pt-20 pb-12">
        <motion.span
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-block text-xs font-semibold uppercase tracking-[0.25em] text-white/85"
        >
          {data.category ?? "Local Service"}
          {data.address?.split(",").slice(-2, -1)[0]?.trim() && (
            <span className="text-white/55"> · {data.address.split(",").slice(-2, -1)[0].trim()}</span>
          )}
        </motion.span>

        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.0, ease: "easeOut" }}
          className="max-w-5xl mx-auto"
        >
          <h1 className="mt-6 text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-semibold tracking-tighter-2 leading-[1.02]">
            {titleWords.map((word, i) => (
              <motion.span
                key={`${word}-${i}`}
                className="inline-block mr-3 last:mr-0"
                initial={{ opacity: 0, y: 100 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: 0.15 + i * 0.07,
                  duration: 0.75,
                  type: "spring",
                  stiffness: 110,
                  damping: 18,
                }}
              >
                <span
                  className="text-transparent bg-clip-text drop-shadow-[0_4px_30px_rgba(0,0,0,0.5)]"
                  style={{
                    backgroundImage:
                      "linear-gradient(135deg, #ffffff 0%, #ffffff 60%, rgb(var(--c-accent)) 100%)",
                  }}
                >
                  {word}
                </span>
              </motion.span>
            ))}
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.55 }}
            className="mt-8 mx-auto max-w-2xl text-lg md:text-xl text-white/85 leading-relaxed"
          >
            {c.hero_subhead}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.85 }}
            className="mt-10 flex flex-col sm:flex-row gap-3 justify-center items-center"
          >
            <a
              href="/contact"
              className={cn(
                "inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full",
                "bg-brand text-brand-text font-semibold text-base",
                "shadow-[0_10px_40px_rgba(0,0,0,0.35)] hover:scale-[1.02] active:scale-[0.98]",
                "transition-transform"
              )}
            >
              {c.cta_primary}
              <ArrowRight size={18} />
            </a>
            {data.phone && (
              <a
                href={telHref(data.phone)}
                className={cn(
                  "inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full",
                  "border border-white/30 bg-white/10 backdrop-blur-md text-white font-semibold text-base",
                  "hover:bg-white/15 transition-all"
                )}
              >
                <Phone size={16} />
                {c.cta_secondary}
              </a>
            )}
          </motion.div>

          {(data.rating || data.review_count) && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.05 }}
              className="mt-12 inline-flex items-center gap-3 rounded-2xl bg-white/8 backdrop-blur-md border border-white/15 px-5 py-3"
            >
              <div className="flex">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={15} className="text-amber-400" fill="currentColor" strokeWidth={0} />
                ))}
              </div>
              <div className="text-sm text-white">
                <span className="font-semibold">{data.rating?.toFixed(1) ?? "5.0"}</span>
                <span className="text-white/70"> · {c.social_proof_line}</span>
              </div>
            </motion.div>
          )}
        </motion.div>
      </div>
    </section>
  );
}
