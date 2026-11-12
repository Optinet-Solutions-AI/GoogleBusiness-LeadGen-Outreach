/**
 * db-errors.ts — recognise Supabase/Postgres errors we deliberately tolerate. Pure.
 *
 * Inputs:  a Supabase error ({ code, message })
 * Outputs: booleans
 * Used by: code that reads/writes a column added by a migration the operator may not have applied yet
 *          (sequence-scheduler, call-scheduler, quick-call, the call preview)
 */

/** Is this "that column doesn't exist" (a migration not applied yet)? */
export function isMissingColumn(err: { message?: string; code?: string } | null | undefined, column: string): boolean {
  if (!err) return false;
  return err.code === "42703" || err.code === "PGRST204" || (err.message ?? "").includes(column);
}
