import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/drive/crypto";
import { exchangeCode, userInfo, DRIVE_SCOPES } from "@/lib/drive/google";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const back = (q: string) => {
    const r = NextResponse.redirect(new URL(`/app/integracoes?${q}`, url.origin));
    r.cookies.delete({ name: "df_drive_oauth", path: "/api/drive" });
    return r;
  };
  const ctx = await getContext();
  const [state, ws] = (request.cookies.get("df_drive_oauth")?.value ?? "").split(".");
  if (!state || state !== url.searchParams.get("state") || ws !== ctx.workspace.id) return back("erro=estado");
  if (url.searchParams.get("error")) return back("erro=negado");
  if (!ctx.can("integrations.manage")) return back("erro=permissao");
  const code = url.searchParams.get("code");
  if (!code) return back("erro=codigo");

  try {
    const tokens = await exchangeCode(code, `${process.env.NEXT_PUBLIC_APP_URL ?? url.origin}/api/drive/callback`);
    if (!tokens.refresh_token) return back("erro=offline");
    const granted = tokens.scope.split(" ");
    if (!granted.includes("https://www.googleapis.com/auth/drive.readonly")) return back("erro=escopo");
    const me = await userInfo(tokens.access_token);
    const admin = createAdminClient();
    const { data: conn, error } = await admin.from("drive_connections").upsert({
      workspace_id: ctx.workspace.id, google_email: me.email, google_sub: me.sub,
      scopes: DRIVE_SCOPES.filter((s) => granted.includes(s) || s === "openid"), status: "active", last_error: null, connected_by: ctx.user.id,
    }, { onConflict: "workspace_id,google_sub" }).select("id").single();
    if (error || !conn) return back("erro=salvar");
    await admin.from("drive_credentials").upsert({
      connection_id: conn.id, refresh_token_encrypted: encrypt(tokens.refresh_token),
      access_token_encrypted: encrypt(tokens.access_token), access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    });
    await admin.from("audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: "integration.drive_connected", entity_type: "drive_connection", entity_id: conn.id, data: { email: me.email } });
    return back("ok=drive");
  } catch {
    return back("erro=google");
  }
}
