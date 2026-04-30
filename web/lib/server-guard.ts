/**
 * server-guard.ts — local shim for the `server-only` Next.js convention.
 *
 * Why a custom shim instead of the npm `server-only` package: that package
 * works by throwing unconditionally on import, relying on Next.js's bundler
 * to intercept and replace it with an inert build-time marker. Outside of
 * Next.js (the Cloud Run Job runs the orchestrator via raw `tsx`), the
 * unconditional throw fires at runtime and the container exits.
 *
 * This shim does the same job — block client-side imports — but only
 * actually throws when a browser environment is detected. In Node (Next.js
 * server runtime, Cloud Run Job, CLI scripts) it's a silent no-op.
 *
 * Usage: `import "@/lib/server-guard";` at the top of any module that
 * touches secrets or DB credentials.
 */

if (typeof window !== "undefined") {
  throw new Error(
    "This module is server-only and cannot be imported from client code.",
  );
}

export {};
