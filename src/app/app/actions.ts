"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext, WS_COOKIE } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function switchWorkspace(id: string) {
  const ctx = await getContext();
  if (!ctx.workspaces.some((w) => w.id === id)) return; // only workspaces with active membership
  (await cookies()).set(WS_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 31536000 });
  redirect("/app");
}

export async function searchAction(q: string) {
  const ctx = await getContext();
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const sb = await createClient();
  const { data } = await sb.rpc("search_global", { p_ws: ctx.workspace.id, p_q: term });
  return (data ?? []) as Array<{ kind: string; id: string; title: string; subtitle: string | null; href: string }>;
}

export async function markNotificationsRead(ids: string[] | "all") {
  const ctx = await getContext();
  const sb = await createClient();
  let q = sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("workspace_id", ctx.workspace.id).is("read_at", null);
  if (ids !== "all") q = q.in("id", ids.slice(0, 500));
  await q;
  revalidatePath("/app", "layout");
}
