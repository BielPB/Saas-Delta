"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser, WS_COOKIE } from "@/lib/auth";
import { fail, friendlyError, type ActionResult } from "@/lib/errors";

const schema = z.object({
  name: z.string().trim().min(2, "Informe o nome da agência.").max(120),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, "Use de 3 a 48 caracteres: letras minúsculas, números e hífen."),
});

export async function createWorkspace(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireUser();
  const parsed = schema.safeParse({ name: form.get("name"), slug: form.get("slug") });
  if (!parsed.success) return fail("Confira os campos.", Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
  const sb = await createClient();
  const { data, error } = await sb.rpc("create_workspace", { p_name: parsed.data.name, p_slug: parsed.data.slug });
  if (error) {
    const msg = friendlyError(error);
    return fail(msg, /endereço/.test(msg) ? { slug: msg } : undefined);
  }
  (await cookies()).set(WS_COOKIE, data as string, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/app?bemvindo=1");
}
