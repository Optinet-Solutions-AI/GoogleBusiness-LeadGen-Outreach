/**
 * crm/timeline-load.ts — read a lead's history from the five tables and merge it. Server-only.
 *
 * Inputs:  lead id
 * Outputs: TimelineItem[] (newest first), capped at 200 rows per table
 * Used by: app/api/leads/[id]/timeline/route.ts
 *
 * Each table is read best-effort: a missing table (migration not applied) yields an empty
 * slice rather than failing the whole panel.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import {
  mergeTimeline,
  type CallRow,
  type MessageRow,
  type NoteRow,
  type OutreachEventRow,
  type StageEventRow,
  type TimelineItem,
} from "./timeline-merge";

const CAP = 200;

async function rows<T>(table: string, leadId: string, cols: string): Promise<T[]> {
  const { data, error } = await getDb().from(table).select(cols).eq("lead_id", leadId).order("created_at", { ascending: false }).limit(CAP);
  if (error) return [];
  return (data ?? []) as unknown as T[];
}

export async function loadTimeline(leadId: string): Promise<TimelineItem[]> {
  const [events, stageEvents, messages, calls, notes] = await Promise.all([
    rows<OutreachEventRow>("outreach_events", leadId, "id,kind,meta,created_at"),
    rows<StageEventRow>("lead_stage_events", leadId, "id,from_stage,to_stage,created_at"),
    rows<MessageRow>("email_messages", leadId, "id,direction,subject,body_snippet,body_text,status,created_at"),
    rows<CallRow>("call_attempts", leadId, "id,status,outcome,duration_sec,created_at,ended_at,meta"),
    rows<NoteRow>("lead_notes", leadId, "id,body,author,created_at"),
  ]);
  return mergeTimeline({ events, stageEvents, messages, calls, notes });
}
