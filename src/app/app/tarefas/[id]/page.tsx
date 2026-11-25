import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { memberMap, taskSelect, type TaskRow } from "@/lib/data";
import { deliverableKind, taskKind, taskStatus, type TaskStatus } from "@/lib/domain";
import { formatDateTime, relative } from "@/lib/format";
import { isUuid } from "@/lib/utils";
import { Avatar, Badge, PageHeader, Panel } from "@/components/ui/primitives";
import { PriorityBadge, TaskStatusBadge } from "@/components/content/badges";
import { TaskQuickActions } from "@/components/tasks/task-actions";
import { TaskEditor } from "./editor";

export const metadata: Metadata = { title: "Tarefa" };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await getContext();
  const sb = await createClient();
  const { data } = await sb.from("tasks").select(taskSelect).eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!data) notFound();
  const t = data as unknown as TaskRow;
  const [{ data: deps }, { data: blocks }, { data: comments }, { data: rev }, members] = await Promise.all([
    sb.from("task_dependencies").select("depends_on_task_id, tasks!task_dependencies_workspace_id_depends_on_task_id_fkey(id, title, status, assignee_id)").eq("task_id", id),
    sb.from("task_dependencies").select("task_id, tasks!task_dependencies_workspace_id_task_id_fkey(id, title, status, assignee_id)").eq("depends_on_task_id", id),
    sb.from("comments").select("id, body, author_id, created_at").eq("task_id", id).order("created_at"),
    sb.from("revision_requests").select("reason, source, created_at").eq("task_id", id).maybeSingle(),
    memberMap(ctx.workspace.id),
  ]);
  const who = t.assignee_id ? members.get(t.assignee_id) : null;
  const mine = t.assignee_id === ctx.user.id;
  const canManage = ctx.can("tasks.manage");
  const depList = (deps ?? []).map((d) => d.tasks as unknown as { id: string; title: string; status: TaskStatus; assignee_id: string | null }).filter(Boolean);
  const blockList = (blocks ?? []).map((d) => d.tasks as unknown as { id: string; title: string; status: TaskStatus; assignee_id: string | null }).filter(Boolean);

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow={<span className="flex gap-1.5"><Link href="/app/tarefas" className="hover:text-fg">Tarefas</Link><span>/</span>
          <Link href={`/app/clientes/${t.client_id}`} className="hover:text-fg">{t.clients?.name}</Link></span>}
        title={t.title}
        actions={(mine || canManage) && <TaskQuickActions task={{ id: t.id, status: t.status, kind: t.kind, hasDeliverable: Boolean(t.deliverable_id), contentId: t.content_id }} canManage={canManage} />}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          {rev && (
            <Panel title={rev.source === "client" ? "Pedido de ajuste do cliente" : "Motivo da invalidação"} className="border-[var(--tone-warning-fg)]/30">
              <p className="whitespace-pre-wrap text-[13px]">“{rev.reason as string}”</p>
              <p className="mt-1 text-xs text-muted">{relative(rev.created_at as string)}</p>
            </Panel>
          )}
          {t.deliverable_id && t.content_id && (
            <Panel title="Entrega obrigatória" className={t.deliverables?.current_version_id ? undefined : "border-[var(--tone-info-fg)]/30"}>
              <p className="text-[13px]">
                {deliverableKind[t.deliverables!.kind]}: {t.deliverables?.current_version_id
                  ? <Badge tone="success">Versão enviada</Badge>
                  : <span className="text-muted">ainda não enviada. A tarefa só pode ser concluída com o arquivo, link ou texto.</span>}
              </p>
              <Link id="entrega" href={`/app/conteudos/${t.content_id}#entrega-${t.deliverables!.kind}`} className="mt-2 inline-block text-[13px] font-medium underline underline-offset-4">
                {t.kind === "adjustment" ? "Enviar nova versão no conteúdo" : "Enviar entrega no conteúdo"}
              </Link>
            </Panel>
          )}
          <TaskEditor task={{ id: t.id, description: t.description ?? "", checklist: t.checklist ?? [], assignee: t.assignee_id, due: t.due_at, priority: t.priority, contentId: t.content_id }}
            canEditMeta={canManage} canEditBody={mine || canManage}
            members={[...members.values()].filter((m) => m.status === "active").map((m) => ({ id: m.user_id, name: m.full_name }))}
            comments={(comments ?? []).map((c) => ({ id: c.id as string, body: c.body as string, at: c.created_at as string, author: members.get(c.author_id as string)?.full_name ?? "—" }))} />
        </div>
        <aside className="space-y-4">
          <Panel title="Resumo">
            <dl className="grid grid-cols-[96px_1fr] gap-y-2 text-[13px]">
              <dt className="text-muted">Status</dt><dd><TaskStatusBadge t={t} /></dd>
              <dt className="text-muted">Tipo</dt><dd>{taskKind[t.kind]}</dd>
              <dt className="text-muted">Prioridade</dt><dd><PriorityBadge p={t.priority} />{["low", "medium"].includes(t.priority) && (t.priority === "low" ? "Baixa" : "Média")}</dd>
              <dt className="text-muted">Responsável</dt><dd className="flex items-center gap-1.5">{who ? <><Avatar name={who.full_name} size={20} />{who.full_name}</> : "—"}</dd>
              <dt className="text-muted">Função</dt><dd>{t.required_role_key ?? "—"}</dd>
              <dt className="text-muted">Prazo</dt><dd>{formatDateTime(t.due_at)}</dd>
              {t.completed_at && <><dt className="text-muted">Concluída</dt><dd>{formatDateTime(t.completed_at)}</dd></>}
              {t.content_items && <><dt className="text-muted">Conteúdo</dt><dd><Link className="underline underline-offset-2" href={`/app/conteudos/${t.content_id}`}>#{t.content_items.code} {t.content_items.title}</Link></dd></>}
            </dl>
          </Panel>
          <Panel title="Depende de" padded={false}>
            {depList.length === 0 ? <p className="px-4 py-3 text-[13px] text-muted">Sem dependências.</p> : (
              <ul className="divide-y divide-border">{depList.map((d) => (
                <li key={d.id}><Link href={`/app/tarefas/${d.id}`} className="flex items-center gap-2 px-4 py-2 text-[13px] hover:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate">{d.title}</span><Badge tone={taskStatus[d.status].tone}>{taskStatus[d.status].label}</Badge></Link></li>
              ))}</ul>
            )}
          </Panel>
          <Panel title="Libera" padded={false}>
            {blockList.length === 0 ? <p className="px-4 py-3 text-[13px] text-muted">Nenhuma tarefa depende desta.</p> : (
              <ul className="divide-y divide-border">{blockList.map((d) => (
                <li key={d.id}><Link href={`/app/tarefas/${d.id}`} className="flex items-center gap-2 px-4 py-2 text-[13px] hover:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate">{d.title}</span><Badge tone={taskStatus[d.status].tone}>{taskStatus[d.status].label}</Badge></Link></li>
              ))}</ul>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
