/**
 * styled-list.tsx — Service area variant: animated city pills + REAL map.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: section with copy + city pills on the left, a Google Maps iframe
 *          centered on the business address (or first service area when the
 *          business is service-area-only) on the right.
 * Used by: pages/index.astro when variants.service_area === 'styled-list'
 *          and pages/service-area.astro
 *
 * Why a real iframe instead of a CSS art map: a stylized fake map reads as
 * a wireframe placeholder to anyone shopping for a local-business website.
 * Google's embed-by-query iframe is free (no API key) and dropping in a real
 * map lifts the entire "is this a real product?" perception bar.
 */
import { motion } from "framer-motion";
import { MapPin } from "lucide-react";
import type { SiteData } from "../../lib/data";

function mapQuery(data: SiteData): string | null {
  // Prefer the business's actual address — it pins the marker on their door.
  // Service-area-only businesses (mobile mechanic, mobile groomer, etc.) have
  // no fixed location, so center on the primary service area instead.
  if (data.address && !data.is_service_area_only) return data.address;
  const firstArea = data.service_areas?.[0];
  if (firstArea) return firstArea;
  return null;
}

export default function StyledServiceArea({ data }: { data: SiteData }) {
  const areas = data.service_areas ?? [];
  if (!areas.length) return null;

  const query = mapQuery(data);
  const mapSrc = query
    ? `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed&z=11`
    : null;

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

      <div className="relative aspect-[4/3] rounded-3xl overflow-hidden bg-surface-alt ring-1 ring-ink/5 shadow-2xl shadow-ink/10">
        {mapSrc ? (
          <iframe
            src={mapSrc}
            title={`Service area map — ${query}`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="absolute inset-0 w-full h-full border-0"
            // The iframe is decorative once the city pills above already give
            // screen-reader users the area list.
            aria-hidden="true"
          />
        ) : (
          // No address AND no service areas — keep a tasteful empty state
          // (rare, mostly defensive).
          <div className="absolute inset-0 grid place-items-center text-ink-muted">
            <MapPin size={32} />
          </div>
        )}
        {/* Floating chip — adds context without obscuring the map */}
        <div className="absolute bottom-4 left-4 bg-surface/95 backdrop-blur rounded-xl px-3 py-2 text-xs font-semibold text-ink border border-ink/5 shadow-lg shadow-ink/10">
          Service map · {areas.length} {areas.length === 1 ? "area" : "areas"}
        </div>
      </div>
    </section>
  );
}
