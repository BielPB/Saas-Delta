import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getContext } from "@/lib/auth";
import {
  contentFilters, listClientsLite, listContents, listFormats, listMembers, listServicesLite, parseFilters, pipelineExtras, qs, thumbnails,
} from "@/lib/data";
import { cn } from "@/lib/utils";
import { FilterBar } from "@/components/content/filter-bar";
import { PipelineBoard, boardColumns } from "@/components/content/pipeline-board";

export const metadata: Metadata = { title: "Pipeline de produção" };

/** Hides cancelled items and contents published more than 14 days ago. */
function boardRows<T extends { stage: string; published_at: string | null }>(rows: T[]) {
  const cutoff = Date.now() - 14 * 864e5;
  return rows.filter((r) => r.stage !== "cancelled" && !(r.stage === "published" && r.published_at && new Date(r.published_at).getTime() < cutoff));
}

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await getContext();
  const f = parseFilters(contentFilters, await searchParams);
  const ws = ctx.workspace.id;
  const [{ rows }, clients, services, formats, members] = await Promise.all([
    listContents(ws, { ...f, publicacao: undefined }, { limit: 400 }),
    listClientsLite(ws), listServicesLite(ws), listFormats(ws), listMembers(ws),
  ]);
  const visible = boardRows(rows);
  const [thumb, extras] = await Promise.all([thumbnails(visible), pipelineExtras(ws, visible.map((r) => r.id))]);
  const byUser = new Map(members.filter((m) => m.user_id).map((m) => [m.user_id, m]));

  const items = visible.map((r) => {
    const who = byUser.get(extras.assignees.get(r.id)?.[0] ?? "");
    return {
      id: r.id, code: r.code, title: r.title, client: r.clients?.name ?? "", stage: r.stage, approval: r.approval_status,
      thumb: thumb(r), aspect: r.content_formats?.aspect_ratio ?? null, planned: r.scheduled_at ?? r.planned_publish_at,
      service: r.client_services ? { name: r.client_services.name, color: r.client_services.color } : null,
      format: r.content_formats?.name ?? "Conteúdo",
      deliverables: extras.deliverables.get(r.id) ?? [],
      assignee: who ? { name: who.full_name, avatar: who.avatar_url } : null,
    };
  });

  const client = clients.find((c) => c.id === f.cliente);
  const service = services.find((s) => s.id === f.servico);
  const title = service?.name ?? client?.name ?? "Todos os projetos";
  const total = items.length;
  const readyStages = boardColumns.find((c) => c.ready)!.stages;
  const ready = items.filter((i) => readyStages.includes(i.stage)).length;
  const inApproval = items.filter((i) => i.stage === "client_approval").length;
  const kindStat = (k: string) => {
    const withKind = items.filter((i) => i.deliverables.some((d) => d.kind === k));
    return { done: withKind.filter((i) => i.deliverables.some((d) => d.kind === k && d.done)).length, total: withKind.length };
  };
  const stats = [["video", "vídeos"], ["cover", "capas"], ["caption", "legendas"]].map(([k, label]) => ({ label, ...kindStat(k) })).filter((s) => s.total > 0);
  const newHref = `/app/conteudos/novo${qs({}, { cliente: f.cliente })}`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted">
            Projetos{client ? <> / <span className={service ? "" : "text-fg"}>{client.name}</span></> : null}
          </p>
          <h1 className="mt-1 text-4xl font-extrabold tracking-tight sm:text-5xl">{title}</h1>
        </div>
        <div className="flex items-center gap-3">
          <nav aria-label="Visão" className="flex rounded-full border border-border bg-surface p-1 text-sm font-semibold">
            <span aria-current="page" className="rounded-full bg-accent px-5 py-2 text-accent-fg">Produção</span>
            <Link href={`/app/aprovacoes${qs({}, { cliente: f.cliente })}`} className="flex items-center gap-2 rounded-full px-5 py-2 text-muted transition-colors hover:text-fg">
              Aprovação
              <span className={cn("tabular flex size-5 items-center justify-center rounded-full text-[11px] font-bold",
                inApproval > 0 ? "bg-accent text-accent-fg" : "bg-surface-3 text-muted")}>{inApproval}</span>
            </Link>
          </nav>
          {ctx.can("contents.manage") && (
            <Link href={newHref} className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-6 text-[15px] font-bold text-accent-fg transition-opacity hover:opacity-90">
              <Plus className="size-5" strokeWidth={2.5} aria-hidden /> Novo conteúdo
            </Link>
          )}
        </div>
      </div>

      <section aria-label="Progresso" className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-border bg-surface px-6 py-4">
        <p className="flex items-baseline gap-2 whitespace-nowrap">
          <span className="tabular text-4xl font-extrabold text-accent-ink">{ready}</span>
          <span className="text-muted">de {total} prontos</span>
        </p>
        <div className="h-2.5 min-w-40 flex-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={ready} aria-label="Conteúdos prontos">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${total ? (ready / total) * 100 : 0}%` }} />
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
          {stats.map((s) => <li key={s.label}><strong className="tabular text-fg">{s.done}/{s.total}</strong> {s.label}</li>)}
        </ul>
      </section>

      <div className="my-5">
        <FilterBar clients={clients} services={services} formats={formats}
          members={members.filter((m) => m.status === "active" && m.user_id).map((m) => ({ id: m.user_id, name: m.full_name }))}
          show={["q", "formato", "aprovacao", "responsavel"]} />
      </div>

      <PipelineBoard canPublish={ctx.can("publications.manage")} items={items} />
    </>
  );
}
