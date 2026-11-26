import type { Metadata } from "next";
import Link from "next/link";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { memberMap } from "@/lib/data";
import { activityText } from "@/lib/activity";
import { formatDateTime } from "@/lib/format";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Atividade" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ antes?: string }> }) {
  const ctx = await getContext();
  const sp = await searchParams;
  const sb = await createClient();
  let q = sb.from("activity_logs").select("id, action, actor_type, actor_label, actor_id, data, created_at, content_id, client_id")
    .eq("workspace_id", ctx.workspace.id).order("id", { ascending: false }).limit(100);
  if (sp.antes && /^\d+$/.test(sp.antes)) q = q.lt("id", Number(sp.antes));
  const [{ data }, members] = await Promise.all([q, memberMap(ctx.workspace.id)]);
  const rows = data ?? [];
  return (
    <>
      <PageHeader title="Atividade" description="Histórico de tudo o que aconteceu nos conteúdos e clientes que você pode ver." />
      <Panel padded={false}>
        {rows.length === 0 ? <EmptyState title="Nada registrado ainda" /> : (
          <ol className="divide-y divide-border">
            {rows.map((ev) => (
              <li key={ev.id as number} className="flex flex-wrap gap-x-3 gap-y-0.5 px-4 py-2 text-[13px] sm:flex-nowrap">
                <time className="shrink-0 text-xs text-subtle max-sm:w-full sm:w-28" dateTime={ev.created_at as string}>{formatDateTime(ev.created_at as string)}</time>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{ev.actor_type === "client" ? `${String(ev.actor_label ?? "Cliente")} (cliente)` : members.get(ev.actor_id as string)?.full_name ?? "Sistema"}</span>{" "}
                  <span className="text-muted">{activityText(ev.action as string, ev.data as Record<string, unknown>)}</span>
                </span>
                {ev.content_id ? <Link className="shrink-0 text-xs text-muted hover:text-fg" href={`/app/conteudos/${String(ev.content_id)}`}>conteúdo</Link> : null}
              </li>
            ))}
          </ol>
        )}
      </Panel>
      {rows.length === 100 && <div className="mt-3 text-right"><Link className="text-[13px] underline" href={`/app/atividade?antes=${rows[rows.length - 1].id}`}>Mais antigas</Link></div>}
    </>
  );
}
