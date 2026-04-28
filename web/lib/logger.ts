/**
 * logger.ts — Structured pino logger.
 *
 * Inputs:  env.LOG_LEVEL, env.APP_ENV
 * Outputs: `log` instance + `getLogger(name)` factory
 * Used by: every module that logs
 */

import pino from "pino";
import { env } from "./config";

// Plain JSON logs everywhere. Pretty-printing via a `transport` spawns a
// worker_thread that breaks Next.js' build-time page-data collection.
// If you want pretty logs locally, pipe stdout through pino-pretty in your
// dev terminal: `npm run dev | npx pino-pretty`.
const base = pino({ level: env.LOG_LEVEL });

export const log = base;
export const getLogger = (name: string) => base.child({ module: name });
