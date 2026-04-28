/**
 * response.ts — Uniform `{ success, data | error }` JSON envelope helpers.
 *
 * Inputs:  data or error message
 * Outputs: NextResponse with proper status
 * Used by: every Route Handler under app/api/*
 */

import { NextResponse } from "next/server";

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ success: true, data }, init);
}

export function fail(error: string, status = 400): NextResponse {
  return NextResponse.json({ success: false, error }, { status });
}
