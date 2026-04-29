/**
 * fetch-json.ts — Client helper that always returns a usable {success,data|error}
 * shape, even when the server returns an empty body or HTML 500 page.
 *
 * Use it in every dashboard component that calls /api/* — never call
 * `await res.json()` directly, since that throws SyntaxError on empty bodies
 * and the user sees a cryptic stack trace instead of the actual problem.
 */

export interface JsonOk<T> {
  success: true;
  data: T;
}
export interface JsonErr {
  success: false;
  error: string;
}
export type JsonResult<T> = JsonOk<T> | JsonErr;

export async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<JsonResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    return { success: false, error: `Network error: ${String(err)}` };
  }

  const text = await res.text();
  if (!text) {
    return { success: false, error: `Empty response (HTTP ${res.status})` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Server returned HTML / plain text — pull a useful preview
    const preview = text.replace(/<[^>]+>/g, " ").trim().slice(0, 200);
    return {
      success: false,
      error: `HTTP ${res.status}: ${preview || "non-JSON response"}`,
    };
  }

  // Already in {success, data|error} envelope
  if (
    parsed &&
    typeof parsed === "object" &&
    "success" in parsed &&
    typeof (parsed as { success: unknown }).success === "boolean"
  ) {
    return parsed as JsonResult<T>;
  }

  // Unwrapped JSON — wrap it ourselves
  return { success: true, data: parsed as T };
}
