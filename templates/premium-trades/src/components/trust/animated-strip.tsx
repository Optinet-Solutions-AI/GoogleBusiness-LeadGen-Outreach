/**
 * animated-strip.tsx — Trust strip: scroll-revealed badges between hero and services.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: row of trust phrases as pill-style badges, animated on view.
 * Used by: pages/index.astro when variants.trust === 'animated-strip'
 */
import { motion } from "framer-motion";
import { ShieldCheck, Clock, Award, BadgeCheck } from "lucide-react";
import type { SiteData } from "../../lib/data";

const ICONS = [ShieldCheck, Clock, Award, BadgeCheck];

export default function AnimatedTrustStrip({ data }: { data: SiteData }) {
  const items = data.copy.trust_strip;
  if (!items?.length) return null;
  return (
    <section className="border-y border-ink/5 bg-surface">
      <div className="container-tight py-8 md:py-10">
        <div className="flex flex-wrap items-center justify-center gap-3 md:gap-5">
          {items.map((t, i) => {
            const Icon = ICONS[i % ICONS.length];
            return (
              <motion.div
                key={t}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: 0.05 * i }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-alt text-ink text-sm font-medium"
              >
                <Icon size={16} className="text-brand" />
                <span>{t}</span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
