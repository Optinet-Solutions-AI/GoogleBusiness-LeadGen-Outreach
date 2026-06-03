/**
 * ScraperBadge.tsx — outline-only chip telling you which scraper a batch used.
 *
 * Per the design brief: scraper badges are always outline-only (never filled),
 * with a small provider-tinted dot prefix. Reads as data label, not status.
 */

export function ScraperBadge({ scraper }: { scraper: string }) {
  const meta =
    scraper === "apify"
      ? { label: "Apify", dot: "bg-positive" }
      : scraper === "google_places"
        ? { label: "Google Places", dot: "bg-action" }
        : scraper === "outscraper"
          ? { label: "Outscraper", dot: "bg-warning" }
          : { label: scraper, dot: "bg-ink-subtle" };

  return (
    <span className="inline-flex items-center gap-1.5 bg-surface text-ink-muted border border-rule px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-[0.14em] font-mono">
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
      {meta.label}
    </span>
  );
}
