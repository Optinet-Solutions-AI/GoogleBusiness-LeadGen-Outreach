/**
 * badge-grid.tsx — Trust variant: clean badge grid (alternative to strip).
 *
 * Inputs:  data prop (SiteData)
 * Outputs: 4 trust signals as outlined badge cards in a grid. More visual
 *          weight than the row-of-pills strip — works well right under
 *          full-bleed-photo or split-with-stats heroes.
 * Used by: pages/index.astro when variants.trust === 'badge-grid'
 *
 * Pick rule: best when trust_strip has substantive entries that benefit
 * from icon emphasis (e.g. "Licensed Master Plumber", "BBB Accredited",
 * "Family Owned Since 1998"). Strip variant is busier; grid is calmer.
 */
import { motion } from "framer-motion";
import { ShieldCheck, Clock, Award, BadgeCheck, Star, Heart, Wrench, Users } from "lucide-react";
import type { SiteData } from "../../lib/data";

const ICON_POOL = [ShieldCheck, BadgeCheck, Award, Clock, Star, Heart, Wrench, Users];

export default function TrustBadgeGrid({ data }: { data: SiteData }) {
  const items = data.copy.trust_strip;
  if (!items?.length) return null;

  return (
    <section className="border-y border-ink/5 bg-surface">
      <div className="container-tight py-12 md:py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {items.slice(0, 4).map((label, i) => {
            const Icon = ICON_POOL[i % ICON_POOL.length];
            return (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.4, delay: 0.05 * i }}
                className="flex flex-col items-start gap-3 p-5 rounded-2xl bg-surface-alt ring-1 ring-ink/5 hover:ring-brand/40 transition-all"
              >
                <div className="grid place-items-center w-10 h-10 rounded-xl bg-brand text-brand-text">
                  <Icon size={18} />
                </div>
                <div className="text-sm font-semibold text-ink leading-tight">{label}</div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
