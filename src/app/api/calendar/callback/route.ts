import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/drive/crypto";
import { appOrigin, requestOrigin } from "@/lib/origin";
import { exchangeCode, userInfo } from "@/lib/drive/google";
import { CALENDAR_SCOPE } from "@/lib/calendar/google";
import { syncCalendar } from "@/lib/calendar/sync";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const back = (q: string) => {
    const r = NextResponse.redirect(new URL(`/app/conta?agenda=${q}`, url.origin));
    r.cookies.delete({ name: "df_cal_oauth", path: "/api/calendar" });
    return r;
  };
  const ctx = await getContext();
  const [state, ws, uid] = (request.cookies.get("df_cal_oauth")?.value ?? "").split(".");
  if (!state || state !== url.searchParams.get("state") || ws !== ctx.workspace.id || uid !== ctx.user.id) return back("erro-estado");
  if (url.searchParams.get("error")) return back("negado");
  const code = url.searchParams.get("code");
  if (!code) return back("erro-codigo");

  try {
    const origin = await appOrigin();
    const tokens = await exchangeCode(code, `${await requestOrigin()}/api/calendar/callback`);
    if (!tokens.refresh_token) return back("erro-offline");
    if (!tokens.scope.split(" ").includes(CALENDAR_SCOPE)) return back("escopo");
    const me = await userInfo(tokens.access_token);
    const admin = createAdminClient();
    const { data: conn, error } = await admin.from("calendar_connections").upsert({
      workspace_id: ctx.workspace.id, user_id: ctx.user.id, google_email: me.email, google_sub: me.sub, status: "active", last_error: null,
    }, { onConflict: "workspace_id,user_id" }).select("id").single();
    if (error || !conn) return back("erro-salvar");
    await admin.from("calendar_credentials").upsert({
      connection_id: conn.id, refresh_token_encrypted: encrypt(tokens.refresh_token),
      access_token_encrypted: encrypt(tokens.access_token), access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    });
    await admin.from("audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: "integration.calendar_connected", entity_type: "calendar_connection", entity_id: conn.id, data: { email: me.email } });
    await syncCalendar(conn.id, origin).catch(() => {}); // first sync; failures show up later as last_error
    return back("ok");
  } catch {
    return back("erro-google");
  }
}
