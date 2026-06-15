/**
 * url-params.ts — build a dashboard URL that flips one or more query params
 * while preserving the others. Pure + framework-free so it unit-tests cleanly
 * and is safe to import from client components.
 *
 * Inputs:  basePath ("/leads"), the currently-active params, and a patch.
 * Outputs: "/leads?stage=replied&verify=valid" (empty/undefined values dropped).
 * Used by: components/ui/FilterSelect + SearchInput, and the list pages.
 */
export function buildFilterUrl(
  basePath: string,
  current: Record<string, string | undefined>,
  patch: Record<string, string | undefined>,
): string {
  const merged: Record<string, string | undefined> = { ...current, ...patch };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
