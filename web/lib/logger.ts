/**
 * logger.ts — Structured pino logger.
 *
 * Inputs:  env.LOG_LEVEL, env.APP_ENV
 * Outputs: `log` instance + `getLogger(name)` factory
 * Used by: every module that logs
 */

import pino from "pino";
import { env } from "./config";

const base = pino({
  level: env.LOG_LEVEL,
  transport:
    env.APP_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

export const log = base;
export const getLogger = (name: string) => base.child({ module: name });
