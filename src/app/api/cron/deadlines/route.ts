import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

/**
 * Daily cron at 08:00 America/Fortaleza (Vercel Hobby allows one run per day; Authorization: Bearer CRON_SECRET).
 * Emits deadline / late-publication notifications (deduped per day in SQL)
 * and runs housekeeping. Never marks anything as published.
 */
export async function GET(request: NextRequest) {
  const secret = serverEnv().cronSecret;
  const got = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const admin = createAdminClient();
  const [{ data, error }, house] = await Promise.all([admin.rpc("run_deadline_scan"), admin.rpc("run_housekeeping")]);
  if (error || house.error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true, ...(data as object) });
}
