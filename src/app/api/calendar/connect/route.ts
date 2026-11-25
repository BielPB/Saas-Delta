import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { integrations } from "@/lib/env";
import { appOrigin } from "@/lib/origin";
import { calendarAuthUrl } from "@/lib/calendar/google";

/** Each person connects their own Google Agenda. */
export async function GET(request: NextRequest) {
  const ctx = await getContext();
  const origin = new URL(request.url).origin;
  if (!integrations.calendar()) return NextResponse.redirect(new URL("/app/conta?agenda=configuracao", origin));
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(calendarAuthUrl(state, `${await appOrigin()}/api/calendar/callback`));
  // State bound to this browser, workspace and person (CSRF protection for the OAuth flow).
  res.cookies.set("df_cal_oauth", `${state}.${ctx.workspace.id}.${ctx.user.id}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/calendar", maxAge: 600 });
  return res;
}
