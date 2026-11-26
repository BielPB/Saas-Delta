import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { relative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { MarkAllRead, NotificationLink } from "./client";

export const metadata: Metadata = { title: "Notificações" };

const cats: Record<string, string> = { tasks: "Tarefas", approvals: "Aprovações", publications: "Publicações", files: "Arquivos", system: "Sistema" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ categoria?: string; lidas?: string }> }) {
  const ctx = await getContext();
  const sp = await searchParams;
  const sb = await createClient();
  let q = sb.from("notifications").select("id, type, category, title, body, link, read_at, created_at").eq("workspace_id", ctx.workspace.id)
    .order("created_at", { ascending: false }).limit(150);
  if (sp.categoria && cats[sp.categoria]) q = q.eq("category", sp.categoria);
  if (sp.lidas !== "1") q = q.is("read_at", null);
  const { data } = await q;
  const rows = data ?? [];
  const tab = (label: string, href: string, on: boolean) => (
    <Link href={href} aria-current={on ? "page" : undefined} className={cn("rounded-md px-2.5 py-1 text-[13px] text-muted hover:text-fg pointer-coarse:py-2", on && "bg-surface-2 font-medium text-fg")}>{label}</Link>
  );
  return (
    <>
      <PageHeader title="Notificações" actions={<><MarkAllRead /><Link href="/app/conta?aba=notificacoes" className="text-[13px] text-muted hover:text-fg">Preferências</Link></>} />
      <div className="mb-3 flex flex-wrap gap-1">
        {tab("Não lidas", "/app/notificacoes", !sp.lidas && !sp.categoria)}
        {tab("Todas", "/app/notificacoes?lidas=1", sp.lidas === "1" && !sp.categoria)}
        {Object.entries(cats).map(([k, v]) => tab(v, `/app/notificacoes?lidas=1&categoria=${k}`, sp.categoria === k))}
      </div>
      <Panel padded={false}>
        {rows.length === 0 ? <EmptyState icon={<Bell />} title="Tudo em dia" description="Você será avisado quando uma tarefa for liberada, um conteúdo for aprovado ou reprovado e quando prazos se aproximarem." /> : (
          <ul className="divide-y divide-border">
            {rows.map((n) => (
              <li key={n.id as string}>
                <NotificationLink id={n.id as string} href={(n.link as string) ?? "/app"} unread={!n.read_at}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-[13px] font-medium">{n.title as string}</span>
                    {n.body && <span className="block truncate text-xs text-muted">{n.body as string}</span>}
                    {/* Phones: category and time go under the text instead of squeezing it. */}
                    <span className="mt-0.5 block text-[11px] text-subtle sm:hidden">{cats[n.category as string]} · {relative(n.created_at as string)}</span>
                  </span>
                  <span className="hidden shrink-0 text-xs text-subtle sm:inline">{cats[n.category as string]} · {relative(n.created_at as string)}</span>
                </NotificationLink>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
