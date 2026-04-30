/**
 * parallax-photos.tsx — Hero variant for photo-rich leads (≥6 photos).
 *
 * Inputs:  data prop (SiteData)
 * Outputs: split layout — copy on the left, parallax photo collage on the right.
 *          Photos drift on scroll using Framer Motion's useScroll/useTransform.
 * Used by: pages/index.astro when variants.hero === 'parallax-photos'
 */
import { motion, useScroll, useTransform } from "framer-motion";
import { Phone, Star } from "lucide-react";
import { useRef } from "react";
import type { SiteData } from "../../lib/data";
import { telHref } from "../../lib/format";

export default function ParallaxPhotosHero({ data }: { data: SiteData }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });

  const y1 = useTransform(scrollYProgress, [0, 1], [0, -120]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, -60]);
  const y3 = useTransform(scrollYProgress, [0, 1], [0, -180]);
  const y4 = useTransform(scrollYProgress, [0, 1], [0, -90]);

  const c = data.copy;
  const photos = data.photos.slice(0, 4);
  const ys = [y1, y2, y3, y4];

  return (
    <section ref={ref} className="relative overflow-hidden">
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(180deg, rgb(var(--c-surface-alt)) 0%, rgb(var(--c-surface)) 100%)",
        }}
      />
      <div className="container-tight pt-16 pb-24 md:pt-24 md:pb-32 grid lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-6">
          <motion.span
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="eyebrow"
          >
            {data.category ?? "Local Service"}
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="mt-4 text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tighter-2 leading-tight-2 text-ink"
          >
            {c.hero_tagline}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.12 }}
            className="mt-6 text-lg md:text-xl text-ink-muted leading-relaxed"
          >
            {c.hero_subhead}
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <a href="/contact" className="btn-primary text-base">
              {c.cta_primary}
            </a>
            {data.phone && (
              <a href={telHref(data.phone)} className="btn-secondary text-base">
                <Phone size={16} aria-hidden /> {c.cta_secondary}
              </a>
            )}
          </motion.div>

          {(data.rating || data.review_count) && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.28 }}
              className="mt-10 flex items-center gap-3"
            >
              <div className="flex">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={18} className="text-amber-400" fill="currentColor" strokeWidth={0} />
                ))}
              </div>
              <span className="text-sm font-semibold text-ink">
                {data.rating?.toFixed(1) ?? "5.0"}
              </span>
              <span className="text-sm text-ink-muted">· {c.social_proof_line}</span>
            </motion.div>
          )}
        </div>

        <div className="lg:col-span-6 relative h-[480px] md:h-[560px] hidden md:block">
          {photos.map((src, i) => {
            const positions = [
              "top-0 left-0 w-[55%] h-[58%]",
              "top-[8%] right-0 w-[42%] h-[44%]",
              "bottom-0 left-[15%] w-[45%] h-[44%]",
              "bottom-[10%] right-[5%] w-[40%] h-[40%]",
            ];
            const rotations = ["-rotate-2", "rotate-3", "-rotate-1", "rotate-2"];
            return (
              <motion.div
                key={src}
                style={{ y: ys[i] }}
                className={`absolute ${positions[i]} ${rotations[i]} rounded-3xl overflow-hidden shadow-2xl shadow-ink/20 ring-1 ring-ink/5`}
              >
                <img
                  src={src}
                  alt=""
                  width={800}
                  height={600}
                  loading={i === 0 ? "eager" : "lazy"}
                  decoding={i === 0 ? "sync" : "async"}
                  fetchPriority={i === 0 ? "high" : "auto"}
                  className="w-full h-full object-cover"
                />
              </motion.div>
            );
          })}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="absolute -bottom-4 left-[8%] bg-surface rounded-2xl shadow-2xl shadow-ink/20 px-5 py-4 flex items-center gap-3 border border-ink/5"
          >
            <div className="grid place-items-center w-10 h-10 rounded-xl bg-brand text-brand-text">
              <Star size={18} fill="currentColor" strokeWidth={0} />
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">
                {data.rating?.toFixed(1) ?? "5.0"} · {data.review_count ?? 0} reviews
              </div>
              <div className="text-xs text-ink-muted">{c.urgency_micro}</div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
