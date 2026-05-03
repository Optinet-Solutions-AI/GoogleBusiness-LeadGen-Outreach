/**
 * full-section.tsx — CTA variant: dramatic full-bleed conversion section.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: full-width section with brand background + photo accent on one
 *          side + conversion copy + primary CTA + phone CTA. Replaces the
 *          smaller container-tight contact CTA at the bottom of /.
 * Used by: pages/index.astro when variants.cta === 'full-section' (in
 *          addition to the always-rendered sticky-bar)
 *
 * Pick rule: best for high-intent niches (emergency services, contractors,
 * service-area businesses) where a punchy bottom-of-page conversion moment
 * earns more clicks than the subtler in-section "Ready to talk?" card.
 */
import { motion } from "framer-motion";
import { Phone, ArrowRight } from "lucide-react";
import type { SiteData } from "../../lib/data";
import { telHref } from "../../lib/format";

export default function FullSectionCTA({ data }: { data: SiteData }) {
  const c = data.copy;
  const accent = data.photos[1] ?? data.photos[0];

  return (
    <section className="relative overflow-hidden bg-brand text-brand-text" id="contact-cta">
      {/* Decorative accent photo on the right (desktop). Hidden on mobile so
          the copy column stays full-width and tappable. */}
      {accent && (
        <div className="absolute top-0 right-0 w-1/2 h-full hidden lg:block">
          <img
            src={accent}
            alt=""
            width={1200}
            height={900}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover opacity-30"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(90deg, rgb(var(--c-primary)) 0%, transparent 100%)",
            }}
          />
        </div>
      )}

      {/* Background ornament — subtle radial accent ball */}
      <div
        aria-hidden
        className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full opacity-20"
        style={{
          background: "radial-gradient(circle, rgb(var(--c-accent)) 0%, transparent 70%)",
        }}
      />

      <div className="relative container-tight py-20 md:py-28">
        <div className="max-w-2xl">
          <motion.span
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="inline-block text-xs font-semibold uppercase tracking-[0.2em] text-brand-text/70"
          >
            Get started
          </motion.span>

          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="mt-3 text-4xl md:text-6xl lg:text-7xl font-semibold tracking-tighter-2 leading-tight-2"
          >
            Ready when you are.
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="mt-5 text-lg md:text-xl text-brand-text/85 max-w-xl"
          >
            {c.contact_blurb}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.25 }}
            className="mt-9 flex flex-wrap gap-3"
          >
            <a
              href="/contact"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-surface text-ink font-semibold shadow-2xl shadow-ink/30 hover:-translate-y-0.5 transition-all"
            >
              {c.cta_primary}
              <ArrowRight size={16} />
            </a>
            {data.phone && (
              <a
                href={telHref(data.phone)}
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full border border-brand-text/30 text-brand-text font-semibold hover:bg-brand-text/10 transition-all"
              >
                <Phone size={16} />
                {data.phone}
              </a>
            )}
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="mt-6 text-sm text-brand-text/60"
          >
            {c.urgency_micro}
          </motion.p>
        </div>
      </div>
    </section>
  );
}
