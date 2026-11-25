import type { Metadata } from "next";
import Link from "next/link";
import { Archive, CalendarDays, Film, GalleryHorizontal, Kanban, List, Plus, Stamp, Table2 } from "lucide-react";
import { getContext } from "@/lib/auth";
import { contentFilters, listClientsLite, listContents, listFormats, listMembers, listServicesLite, parseFilters, qs, thumbnails } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { FilterBar } from "@/components/content/filter-bar";
import { ContentTable, Thumb } from "@/components/content/content-table";
import { ApprovalBadge, PublicationBadge, ServiceDot, StageBadge } from "@/components/content/badges";
import { PipelineBoard } from "@/components/content/pipeline-board";
import { CalendarMonth } from "@/components/calendar/calendar-month";
import { bulkFromForm } from "./actions";

export const metadata: Metadata = { title: "Conteúdos" };

const views = [
  { key: "lista", label: "Lista", icon: <List /> }, { key: "tabela", label: "Tabela", icon: <Table2 /> },
  { key: "kanban", label: "Kanban", icon: <Kanban /> }, { key: "galeria", label: "Galeria", icon: <GalleryHorizontal /> },
  { key: "calendario", label: "Calendário", icon: <CalendarDays /> },
] as const;

export default async function ContentsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await getContext();
  const raw = await searchParams;
  const f = parseFilters(contentFilters, raw);
  const view = f.visao ?? "lista";
  const ws = ctx.workspace.id;
  const big = view === "kanban" || view === "calendario";
  const [{ rows, total, page, limit }, clients, services, formats, members] = await Promise.all([
    listContents(ws, f, { limit: big ? 300 : view === "galeria" ? 48 : 50 }),
    listClientsLite(ws), listServicesLite(ws), listFormats(ws), listMembers(ws),
  ]);
  const thumb = await thumbnails(rows);
  const base = Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "pagina"));
  const pages = Math.ceil(total / limit);

  return (
    <>
      <PageHeader title="Conteúdos" description={`${total} conteúdo(s)${f.arquivados ? " arquivado(s)" : ""}`}
        actions={<>
          <Link href={f.arquivados ? "/app/conteudos" : "/app/conteudos?arquivados=1"} className="text-[13px] text-muted hover:text-fg">
            {f.arquivados ? "Ver ativos" : "Arquivados"}
          </Link>
          {ctx.can("contents.manage") && <ButtonLink href="/app/conteudos/novo" variant="primary"><Plus /> Novo conteúdo</ButtonLink>}
        </>} />

      <div className="mb-3 flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Modo de visualização">
        {views.map((v) => (
          <Link key={v.key} role="tab" aria-selected={view === v.key} href={`/app/conteudos${qs(base, { visao: v.key === "lista" ? undefined : v.key })}`}
            className={cn("flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted hover:bg-surface-2 hover:text-fg [&_svg]:size-4",
              view === v.key && "bg-surface-2 font-medium text-fg")}>
            {v.icon}{v.label}
          </Link>
        ))}
      </div>

      <FilterBar clients={clients} services={services} formats={formats}
        members={members.filter((m) => m.status === "active" && m.user_id).map((m) => ({ id: m.user_id, name: m.full_name }))}
        show={view === "kanban" ? ["q", "cliente", "servico", "formato", "aprovacao", "responsavel"] : undefined} />

      {rows.length === 0 ? (
        <Panel><EmptyState icon={<Film />} title="Nenhum conteúdo encontrado" description="Ajuste os filtros ou crie um novo conteúdo."
          action={ctx.can("contents.manage") && <ButtonLink href="/app/conteudos/novo" variant="primary"><Plus /> Novo conteúdo</ButtonLink>} /></Panel>
      ) : view === "tabela" ? (
        <Panel padded={false}>
          {ctx.can("contents.manage") && (
            <form id="bulk" action={bulkFromForm} className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-[13px]">
              <span className="text-muted">Com selecionados:</span>
              {ctx.can("approvals.manage") && <Button size="sm" type="submit" name="op" value="approval"><Stamp /> Gerar link de aprovação</Button>}
              {f.arquivados
                ? <Button size="sm" type="submit" name="op" value="restore">Restaurar</Button>
                : <Button size="sm" type="submit" name="op" value="archive"><Archive /> Arquivar</Button>}
            </form>
          )}
          <ContentTable rows={rows} thumb={thumb} selectable={ctx.can("contents.manage")} formId="bulk" />
        </Panel>
      ) : view === "kanban" ? (
        <PipelineBoard items={rows.map((r) => ({
          id: r.id, code: r.code, title: r.title, client: r.clients?.name ?? "", stage: r.stage, approval: r.approval_status,
          thumb: thumb(r), aspect: r.content_formats?.aspect_ratio ?? null, planned: r.scheduled_at ?? r.planned_publish_at,
          service: r.client_services ? { name: r.client_services.name, color: r.client_services.color } : null,
        }))} canPublish={ctx.can("publications.manage")} />
      ) : view === "galeria" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/app/conteudos/${r.id}`} className="group block overflow-hidden rounded-lg border border-border bg-surface hover:border-border-strong">
                <Thumb url={thumb(r)} aspect={r.content_formats?.aspect_ratio === "16:9" ? "16:9" : "4:5"} className="w-full rounded-none border-0" />
                <div className="space-y-1 p-2.5">
                  <p className="truncate text-[13px] font-medium"><span className="font-mono text-xs text-subtle">#{r.code}</span> {r.title}</p>
                  <p className="truncate text-xs text-muted">{r.clients?.name} · {r.content_formats?.name}</p>
                  <div className="flex flex-wrap gap-1"><StageBadge s={r.stage} /></div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : view === "calendario" ? (
        <CalendarMonth items={rows.map((r) => ({
          id: r.id, code: r.code, title: r.title, client: r.clients?.name ?? "", at: r.scheduled_at ?? r.planned_publish_at,
          publication_status: r.publication_status, approval_status: r.approval_status, planned_publish_at: r.planned_publish_at, scheduled_at: r.scheduled_at,
          color: r.client_services?.color ?? null, thumb: thumb(r), channel: r.channel, format: r.content_formats?.name ?? "",
        }))} canEdit={ctx.can("publications.manage") || ctx.can("contents.manage")} />
      ) : (
        <Panel padded={false}>
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/app/conteudos/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                  <Thumb url={thumb(r)} aspect={r.content_formats?.aspect_ratio} className="w-8" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium"><span className="font-mono text-xs text-subtle">#{r.code}</span> {r.title}</p>
                    <p className="flex items-center gap-2 truncate text-xs text-muted">
                      {r.clients?.name} · {r.content_formats?.name}
                      {r.client_services && <ServiceDot color={r.client_services.color} name={r.client_services.name} />}
                    </p>
                  </div>
                  <span className="hidden sm:inline-flex"><StageBadge s={r.stage} /></span>
                  <span className="hidden md:inline-flex"><ApprovalBadge s={r.approval_status} /></span>
                  <span className="hidden lg:inline-flex"><PublicationBadge c={r} /></span>
                  <span className="tabular w-14 text-right text-xs text-muted">{formatDate(r.scheduled_at ?? r.planned_publish_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {!big && pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-[13px]" aria-label="Paginação">
          <span className="text-muted">Página {page} de {pages}</span>
          <div className="flex gap-2">
            {page > 1 && <ButtonLink size="sm" href={`/app/conteudos${qs(base, { pagina: page - 1 })}`}>Anterior</ButtonLink>}
            {page < pages && <ButtonLink size="sm" href={`/app/conteudos${qs(base, { pagina: page + 1 })}`}>Próxima</ButtonLink>}
          </div>
        </nav>
      )}
    </>
  );
}
