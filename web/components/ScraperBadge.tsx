/**
 * ScraperBadge.tsx — small chip telling you which scraper a batch used.
 */

export function ScraperBadge({ scraper }: { scraper: string }) {
  if (scraper === "google_places") {
    return (
      <span className="bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
        Google Places
      </span>
    );
  }
  if (scraper === "outscraper") {
    return (
      <span className="bg-orange-50 text-orange-700 border border-orange-100 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
        Outscraper
      </span>
    );
  }
  return (
    <span className="bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
      {scraper}
    </span>
  );
}
