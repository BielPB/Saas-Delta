import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { syncCalendar } from "@/lib/calendar/sync";

/**
 * Daily cron at 08:00 America/Fortaleza (Vercel Hobby allows one run per day; Authorization: Bearer CRON_SECRET).
 * Emits deadline / late-publication notifications (deduped per day in SQL)
 * and runs housekeeping. Never marks anything as published.
 */
export const maxDuration = 60; // calendar sync of several people

export async function GET(request: NextRequest) {
  const secret = serverEnv().cronSecret;
  const got = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const admin = createAdminClient();
  const [{ data, error }, house] = await Promise.all([admin.rpc("run_deadline_scan"), admin.rpc("run_housekeeping")]);
  if (error || house.error) return NextResponse.json({ ok: false }, { status: 500 });

  // Daily safety net for Google Agenda: keeps everyone's events in sync even without visits.
  let calendars = 0;
  const origin = process.env.NEXT_PUBLIC_APP_URL && !/localhost/.test(process.env.NEXT_PUBLIC_APP_URL) ? process.env.NEXT_PUBLIC_APP_URL : new URL(request.url).origin;
  const { data: conns } = await admin.from("calendar_connections").select("id").eq("status", "active").order("last_synced_at", { ascending: true, nullsFirst: true }).limit(40);
  for (const c of conns ?? []) { try { await syncCalendar(c.id as string, origin); calendars++; } catch { /* recorded as last_error */ } }
  return NextResponse.json({ ok: true, calendars, ...(data as object) });
}
