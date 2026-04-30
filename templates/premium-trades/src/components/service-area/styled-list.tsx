/**
 * styled-list.tsx — Service area variant: animated city pills + map mockup.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: section with copy on the left, a stylized "service map" panel on
 *          the right (CSS-only — no Leaflet dependency). Pulse markers.
 * Used by: pages/index.astro when variants.service_area === 'styled-list'
 *          and pages/service-area.astro
 */
import { motion } from "framer-motion";
import { MapPin } from "lucide-react";
import type { SiteData } from "../../lib/data";

export default function StyledServiceArea({ data }: { data: SiteData }) {
  const areas = data.service_areas ?? [];
  if (!areas.length) return null;

  return (
    <section className="container-tight py-24 grid lg:grid-cols-2 gap-12 items-center" id="areas">
      <div>
        <span className="eyebrow">Where we work</span>
        <h2 className="mt-2 text-4xl md:text-6xl font-semibold tracking-tighter-2 text-ink">
          Local to {areas[0]}
        </h2>
        <p className="mt-4 text-lg text-ink-muted leading-relaxed">{data.copy.service_area_intro}</p>
        <div className="mt-8 flex flex-wrap gap-2">
          {areas.map((a, i) => (
            <motion.span
              key={a}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: 0.04 * i }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-surface-alt text-ink text-sm font-medium"
            >
              <MapPin size={12} className="text-brand" />
              {a}
            </motion.span>
          ))}
        </div>
      </div>

      <div className="relative aspect-[4/3] rounded-3xl overflow-hidden bg-surface-alt ring-1 ring-ink/5">
        {/* Stylized map: layered radial gradients + a grid */}
        <div className="absolute inset-0" style={{
          background:
            "radial-gradient(circle at 30% 40%, rgb(var(--c-primary) / 0.15), transparent 50%)," +
            "radial-gradient(circle at 70% 60%, rgb(var(--c-accent) / 0.12), transparent 50%)",
        }} />
        <div className="absolute inset-0 opacity-40" style={{
          backgroundImage:
            "linear-gradient(to right, rgb(var(--c-neutral-500) / 0.2) 1px, transparent 1px)," +
            "linear-gradient(to bottom, rgb(var(--c-neutral-500) / 0.2) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }} />

        {/* Pulse markers — pseudo-positions across the panel */}
        {areas.slice(0, 6).map((a, i) => {
          const positions = [
            { left: "22%", top: "30%" },
            { left: "55%", top: "25%" },
            { left: "70%", top: "55%" },
            { left: "35%", top: "65%" },
            { left: "60%", top: "75%" },
            { left: "45%", top: "45%" },
          ];
          return (
            <motion.div
              key={a}
              initial={{ scale: 0, opacity: 0 }}
              whileInView={{ scale: 1, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 * i, type: "spring", stiffness: 300, damping: 20 }}
              className="absolute"
              style={positions[i]}
            >
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full rounded-full bg-brand opacity-60 animate-ping" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-brand" />
              </span>
              <span className="absolute left-5 top-1/2 -translate-y-1/2 whitespace-nowrap text-xs font-semibold text-ink bg-surface px-2 py-1 rounded-md shadow-md shadow-ink/10 border border-ink/5">
                {a}
              </span>
            </motion.div>
          );
        })}

        <div className="absolute bottom-4 left-4 bg-surface/90 backdrop-blur rounded-xl px-3 py-2 text-xs font-semibold text-ink border border-ink/5">
          Service map · {areas.length} areas
        </div>
      </div>
    </section>
  );
}
