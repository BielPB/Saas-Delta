import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { integrations } from "@/lib/env";
import { appOrigin } from "@/lib/origin";
import { authUrl } from "@/lib/drive/google";

export async function GET(request: NextRequest) {
  const ctx = await getContext();
  const origin = new URL(request.url).origin;
  if (!ctx.can("integrations.manage")) return NextResponse.redirect(new URL("/app/integracoes?erro=permissao", origin));
  if (!integrations.drive()) return NextResponse.redirect(new URL("/app/integracoes?erro=configuracao", origin));
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authUrl(state, `${await appOrigin()}/api/drive/callback`));
  // State is bound to this browser AND this workspace (CSRF protection for the OAuth flow).
  res.cookies.set("df_drive_oauth", `${state}.${ctx.workspace.id}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/drive", maxAge: 600 });
  return res;
}
