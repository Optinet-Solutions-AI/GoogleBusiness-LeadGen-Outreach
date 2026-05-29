/**
 * editorial-split.tsx — Hero variant: newspaper-ad editorial.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: full-bleed hero with paper-cream background, masthead row
 *          (eyebrow + rating chip), massive Fraunces display headline
 *          owning the left column, full-bleed photo on the right with
 *          floating social-proof callout, monospace phone display, and
 *          a bottom trust-rule strip. One choreographed entrance.
 * Used by: pages/index.astro when variants.hero === 'editorial-split'
 *
 * Aesthetic direction: "Sunday-paper local-service ad, rebuilt with 2026
 * precision." Print-era confidence — slabby display type, brand-color
 * rules, paper grain, a phone number sized like it's painted on a service
 * van. Counter-programs the SaaS-hero sea of pill-buttons and tasteful
 * gradients. Best for businesses where the operator IS the brand
 * (trades, salons, restaurants, family law).
 */
import { motion } from "framer-motion";
import { Phone, ArrowUpRight } from "lucide-react";
import type { SiteData } from "../../lib/data";
import { telHref, headlineLocation } from "../../lib/format";

// Pull the strongest "since/years" line out of trust_strip so we can hero it
// at the bottom of the column. Falls back to "Locally owned" so the line is
// never empty.
function yearsBadge(trust: string[]): string {
  return (
    trust.find((t) => /\d+\+?\s*year/i.test(t)) ??
    trust.find((t) => /licensed/i.test(t)) ??
    "Locally owned"
  );
}

export default function EditorialSplitHero({ data }: { data: SiteData }) {
  const c = data.copy;
  const heroImg = data.photos[0];
  // "City, ST" beats bare "City" for cities with ambiguous names
  // (most famously "Mobile" → reads as adjective without the state).
  const city = headlineLocation(data.address);
  const years = yearsBadge(c.trust_strip);

  return (
    <section
      className="relative w-full overflow-hidden"
      role="banner"
      aria-label="Hero"
      style={{
        // Paper-cream base layered with brand-color radial wash + an SVG
        // noise overlay for printed-paper texture. The result is warm,
        // tactile, and immediately reads as "designed", not "default".
        background:
          "linear-gradient(180deg, #FBF7F1 0%, #F6EFE5 100%)",
      }}
    >
      {/* Paper-grain noise overlay — inline SVG so there's no extra
          request. Opacity tuned so it reads as texture but never as
          visual noise on copy. */}
      <div
        className="absolute inset-0 pointer-events-none mix-blend-multiply opacity-[0.18]"
        aria-hidden
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          backgroundSize: "200px 200px",
        }}
      />

      {/* Brand-color radial wash — anchors the page in the brand, not
          just a clean cream. Subtle so the type still owns the page. */}
      <div
        className="absolute inset-x-0 top-0 h-full -z-0 pointer-events-none"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 8% 0%, rgb(var(--c-primary) / 0.10) 0%, transparent 55%), radial-gradient(ellipse 60% 50% at 95% 90%, rgb(var(--c-accent) / 0.10) 0%, transparent 60%)",
        }}
      />

      <div className="relative mx-auto w-full max-w-[1480px] px-5 sm:px-6 md:px-8 lg:px-14 pt-8 md:pt-12 lg:pt-14">
        {/* ── MASTHEAD: eyebrow + rating chip ─────────────────────────
            Single full-width row that frames the page like the
            top of a print ad. Brand-color rule below separates it
            from the headline. */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-wrap items-center justify-between gap-y-2 gap-x-4 pb-4 md:pb-5 border-b-2"
          style={{ borderColor: "rgb(var(--c-primary))" }}
        >
          {/* Eyebrow row — keep the editorial vibe (small caps separated
              by middots) but drop the noisy bits:
                - data.category is the raw Google taxonomy slug
                  ("HOME_GOODS_STORE") which reads like a database key
                  rather than a brand statement.
                - rating + review count duplicate the dedicated reviews
                  section further down, and on a 5-review business the
                  number looks small rather than impressive.
              City + "Locally owned + operated" carry the entire local-
              business signal on their own. */}
          <div className="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs font-semibold tracking-[0.2em] sm:tracking-[0.25em] uppercase">
            {city && (
              <span style={{ color: "rgb(var(--c-primary))" }}>{city}</span>
            )}
            {city && (
              <span className="opacity-30">·</span>
            )}
            <span className="text-ink-muted">Locally owned + operated</span>
          </div>
        </motion.div>

        {/* ── MAIN GRID — side-by-side from md (768px), stacked below ── */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-8 lg:gap-12 pt-8 md:pt-10 lg:pt-14 pb-10 md:pb-12">
          {/* ── LEFT: headline, subhead, CTAs, phone ──────────────── */}
          <div className="md:col-span-7 flex flex-col">
            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.85, ease: [0.2, 0.7, 0.2, 1] }}
              className="font-heading font-semibold tracking-[-0.025em] text-ink"
              style={{
                // Optical-sized Fraunces at full display weight. clamp()
                // keeps the headline commanding from 380px (small phone)
                // → 1480px (desktop) without an avalanche of breakpoint
                // overrides. The cap holds it from blowing out on iPad
                // landscape / 1080p where 6vw would otherwise hit 80px+.
                fontSize: "clamp(2.25rem, 5.2vw, 4.75rem)",
                lineHeight: 1.0,
                fontVariationSettings: '"opsz" 144',
              }}
            >
              {c.hero_tagline}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2 }}
              className="mt-5 md:mt-6 text-base md:text-lg lg:text-xl text-ink-muted leading-[1.55] max-w-[36rem]"
            >
              {c.hero_subhead}
            </motion.p>

            {/* ── Action row: blocky primary CTA + huge phone display.
                Stacks vertically through `md` so the tablet column doesn't
                squeeze both into a wrapping row — switches to side-by-side
                at `lg` where there's actual room. ── */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.35 }}
              className="mt-7 md:mt-8 lg:mt-9 flex flex-col items-center md:items-start lg:flex-row lg:items-center gap-5 lg:gap-8"
            >
              <a
                href="/contact"
                className="group inline-flex items-center justify-center gap-2.5 px-6 md:px-7 py-3.5 md:py-4 text-sm md:text-base font-semibold transition-all hover:-translate-y-0.5 whitespace-nowrap self-stretch sm:self-auto md:self-start"
                style={{
                  background: "rgb(var(--c-primary))",
                  color: "rgb(var(--c-primary-text))",
                  borderRadius: "2px",
                  boxShadow:
                    "4px 4px 0 0 rgb(var(--c-accent)), 0 12px 30px rgb(var(--c-primary) / 0.25)",
                }}
              >
                {c.cta_primary}
                <ArrowUpRight
                  size={18}
                  className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                />
              </a>

              {data.phone && (
                <a
                  href={telHref(data.phone)}
                  className="group flex items-center gap-3"
                >
                  <div
                    className="flex items-center justify-center w-10 h-10 md:w-11 md:h-11 rounded-full border-2 transition-colors shrink-0"
                    style={{
                      borderColor: "rgb(var(--c-primary))",
                      color: "rgb(var(--c-primary))",
                    }}
                  >
                    <Phone size={16} />
                  </div>
                  <div className="leading-tight min-w-0">
                    <div className="text-[10px] font-semibold tracking-[0.22em] uppercase text-ink-muted">
                      {c.cta_secondary} — 24/7
                    </div>
                    <div
                      className="text-xl md:text-2xl lg:text-3xl font-semibold tabular-nums tracking-tight text-ink group-hover:underline underline-offset-4 whitespace-nowrap"
                      style={{ fontVariationSettings: '"opsz" 144' }}
                    >
                      {data.phone}
                    </div>
                  </div>
                </a>
              )}
            </motion.div>

            {/* ── Trust-rule strip — bottom of the column, full width.
                Reads like the small-print bar on a print ad. ── */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.7, delay: 0.5 }}
              className="mt-8 md:mt-10 lg:mt-12 pt-4 md:pt-5 border-t flex flex-wrap items-center gap-x-4 lg:gap-x-5 gap-y-2"
              style={{ borderColor: "rgb(var(--c-neutral-900) / 0.12)" }}
            >
              {c.trust_strip.slice(0, 4).map((item, i) => (
                <div
                  key={item}
                  className="flex items-center gap-2 text-[10px] sm:text-xs font-semibold tracking-[0.12em] sm:tracking-[0.15em] uppercase text-ink"
                >
                  {i > 0 && (
                    <span
                      className="inline-block w-1 h-1 rounded-full"
                      style={{ background: "rgb(var(--c-accent))" }}
                    />
                  )}
                  <span>{item}</span>
                </div>
              ))}
            </motion.div>
          </div>

          {/* ── RIGHT: full-bleed photo with print-era treatment ────── */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.1, delay: 0.15, ease: [0.2, 0.7, 0.2, 1] }}
            className="md:col-span-5 relative"
          >
            <div
              className="relative aspect-[4/5] sm:aspect-[16/10] md:aspect-auto md:min-h-[480px] lg:min-h-[640px] xl:min-h-[700px] overflow-hidden"
              style={{
                // Square corners on top + slight outer ring to feel like a
                // pasted-in feature photo, not a SaaS image card. Heavy
                // shadow grounds it on the paper.
                boxShadow:
                  "0 30px 60px -20px rgb(var(--c-neutral-900) / 0.35), 0 0 0 1px rgb(var(--c-neutral-900) / 0.08)",
              }}
            >
              {heroImg && (
                <img
                  src={heroImg}
                  alt=""
                  width={1600}
                  height={2000}
                  fetchPriority="high"
                  decoding="sync"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}

              {/* Soft brand-warm overlay — keeps the photo readable + ties
                  it to the brand palette without going full duotone. */}
              <div
                className="absolute inset-0 pointer-events-none"
                aria-hidden
                style={{
                  background:
                    "linear-gradient(180deg, rgb(var(--c-primary) / 0.0) 35%, rgb(var(--c-neutral-900) / 0.65) 100%)",
                }}
              />

              {/* Top-right accent tag — print "ON CALL TONIGHT" stamp */}
              <motion.div
                initial={{ opacity: 0, rotate: -6, y: -8 }}
                animate={{ opacity: 1, rotate: -4, y: 0 }}
                transition={{ duration: 0.6, delay: 0.55 }}
                className="absolute top-5 right-5 px-3 py-1.5 text-[10px] font-bold tracking-[0.2em] uppercase"
                style={{
                  background: "rgb(var(--c-accent))",
                  color: "rgb(var(--c-primary-text))",
                  boxShadow: "2px 2px 0 0 rgb(var(--c-neutral-900) / 0.85)",
                }}
              >
                {c.urgency_micro || "On call tonight"}
              </motion.div>

              {/* Bottom social-proof block — large + legible + brand-anchored */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.65 }}
                className="absolute bottom-0 left-0 right-0 p-5 md:p-6"
              >
                {/* Photo overlay: brand-anchored social-proof line only.
                    Star row + numeric rating dropped — they reproduce the
                    dedicated reviews section + Google's auto-snippets
                    handle review credibility better than an inline chip. */}
                <p
                  className="text-white font-heading font-semibold leading-[1.15] tracking-tight"
                  style={{
                    fontSize: "clamp(1.125rem, 1.6vw, 1.5rem)",
                    fontVariationSettings: '"opsz" 144',
                    textShadow: "0 2px 12px rgb(0 0 0 / 0.4)",
                  }}
                >
                  {c.social_proof_line}
                </p>
              </motion.div>
            </div>

            {/* Floating "since" badge — paper-card style, anchored to the
                outside-left of the photo, sealed with brand color.
                Hidden below xl because at lg the text column gets cramped
                and the badge sits awkwardly on top of the headline. */}
            <motion.div
              initial={{ opacity: 0, x: 20, rotate: 8 }}
              animate={{ opacity: 1, x: 0, rotate: 4 }}
              transition={{ duration: 0.7, delay: 0.8 }}
              className="hidden xl:flex absolute -left-8 top-12 flex-col items-center justify-center w-24 h-24 text-center"
              style={{
                background: "rgb(var(--c-surface))",
                boxShadow:
                  "0 20px 40px -12px rgb(var(--c-neutral-900) / 0.35), 0 0 0 1px rgb(var(--c-neutral-900) / 0.08)",
              }}
            >
              <div
                className="text-[9px] font-bold tracking-[0.25em] uppercase"
                style={{ color: "rgb(var(--c-primary))" }}
              >
                Since
              </div>
              <div
                className="font-heading text-xl font-semibold text-ink leading-none mt-1"
                style={{ fontVariationSettings: '"opsz" 144' }}
              >
                {years.match(/\d+/)?.[0] ?? "Day 1"}
              </div>
              <div className="text-[8px] font-semibold tracking-[0.18em] uppercase text-ink-muted mt-1">
                {years.match(/\d+/) ? "years" : "in town"}
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
