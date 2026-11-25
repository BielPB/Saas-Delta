import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { memberMap, taskSelect, type TaskRow } from "@/lib/data";
import { deliverableKind, taskStatus, type TaskStatus } from "@/lib/domain";
import { formatDateTime, relative } from "@/lib/format";
import { cn, isUuid } from "@/lib/utils";
import { Avatar, Badge, PageHeader } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
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

  const delivered = Boolean(t.deliverables?.current_version_id);
  const waitingOn = depList.filter((d) => !["done", "cancelled"].includes(d.status));
  const entregaHref = t.content_id && t.deliverables ? `/app/conteudos/${t.content_id}#entrega-${t.deliverables.kind}` : null;
  const kindName = t.deliverables ? deliverableKind[t.deliverables.kind].toLowerCase() : "";

  // One sentence: what this person has to do now.
  const now: { tone: "warning" | "info" | "neutral" | "success"; title: string; text?: string; quote?: string; cta?: { href: string; label: string } } =
    t.status === "done" ? { tone: "success", title: `Concluída ${t.completed_at ? relative(t.completed_at) : ""}`.trim() }
    : t.status === "cancelled" ? { tone: "neutral", title: "Tarefa cancelada" }
    : t.status === "blocked" ? { tone: "neutral", title: "Esperando a etapa anterior", text: waitingOn.length ? `Libera quando concluírem: ${waitingOn.map((d) => d.title.split(" — ")[0]).join(", ")}.` : "Libera automaticamente quando a etapa anterior for concluída." }
    : t.status === "in_review" ? { tone: "info", title: "Em revisão pela gestão", text: "Aguarde a aprovação ou um pedido de ajuste." }
    : t.kind === "adjustment" ? {
        tone: "warning", title: rev?.source === "client" ? "O cliente pediu um ajuste" : "Ajuste solicitado", quote: (rev?.reason as string | undefined) ?? undefined,
        text: delivered ? "Nova versão enviada? Conclua a tarefa para devolver ao cliente." : `Envie uma nova versão${kindName ? ` (${kindName})` : ""} e depois conclua.`,
        cta: entregaHref ? { href: entregaHref, label: "Enviar nova versão" } : undefined,
      }
    : t.kind === "review" ? { tone: "info", title: "Revise o conteúdo", text: "Confira os arquivos. Ao concluir, o conteúdo é liberado para o cliente aprovar.", cta: t.content_id ? { href: `/app/conteudos/${t.content_id}`, label: "Abrir conteúdo" } : undefined }
    : t.deliverable_id ? (delivered
        ? { tone: "info", title: "Entrega enviada", text: "Se estiver tudo certo, clique em Concluir." }
        : { tone: "info", title: `Envie a entrega${kindName ? ` (${kindName})` : ""}`, text: "A tarefa só pode ser concluída depois do envio.", cta: entregaHref ? { href: entregaHref, label: "Enviar entrega" } : undefined })
    : { tone: "info", title: t.status === "in_progress" ? "Em andamento" : "Pronta para começar",
        text: t.kind === "general" && t.content_id && t.step_key
          ? `Ao concluir, o post avança para ${({ script: "Gravação", capture: "Edição", editing: "Finalização", finishing: "Finalização (pronto para enviar ao cliente)" } as Record<string, string>)[t.step_key] ?? "a próxima etapa"} no pipeline.`
          : "Use Iniciar e Concluir no topo da página.",
        cta: t.content_id ? { href: `/app/conteudos/${t.content_id}`, label: "Abrir post" } : undefined };

  const facts: Array<[string, React.ReactNode]> = [
    ["Status", <TaskStatusBadge key="s" t={t} />],
    ["Responsável", who ? <span key="w" className="inline-flex items-center gap-1.5"><Avatar name={who.full_name} src={who.avatar_url} size={20} />{who.full_name}</span> : <span key="w" className="text-muted">Sem responsável</span>],
    ["Prazo", t.due_at ? formatDateTime(t.due_at) : null],
    ["Prioridade", ["high", "urgent"].includes(t.priority) ? <PriorityBadge key="p" p={t.priority} /> : null],
    ["Conteúdo", t.content_items ? <Link key="c" className="underline underline-offset-2" href={`/app/conteudos/${t.content_id}`}>#{t.content_items.code} {t.content_items.title}</Link> : null],
  ];
  const sequence = [...depList.map((d) => ({ ...d, rel: "antes" as const })), ...blockList.map((d) => ({ ...d, rel: "depois" as const }))];

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow={<span className="flex gap-1.5"><Link href="/app/tarefas" className="hover:text-fg">Tarefas</Link><span>/</span>
          <Link href={`/app/clientes/${t.client_id}`} className="hover:text-fg">{t.clients?.name}</Link></span>}
        title={t.title}
        actions={(mine || canManage) && <TaskQuickActions task={{ id: t.id, status: t.status, kind: t.kind, hasDeliverable: Boolean(t.deliverable_id), contentId: t.content_id }} canManage={canManage} />}
      />

      <section id="entrega" aria-label="O que fazer agora" className={cn("mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3",
        now.tone === "warning" ? "border-[var(--tone-warning-fg)]/40 bg-[var(--tone-warning-bg)]"
          : now.tone === "success" ? "border-[var(--tone-success-fg)]/30 bg-[var(--tone-success-bg)]" : "border-border bg-surface")}>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">O que fazer agora</p>
          <p className="mt-0.5 text-[15px] font-semibold">{now.title}</p>
          {now.quote && <p className="mt-1 text-[13px]">“{now.quote}”</p>}
          {now.text && <p className="mt-0.5 text-[13px] text-muted">{now.text}</p>}
        </div>
        {now.cta && (mine || canManage) && <ButtonLink href={now.cta.href} variant="primary" size="sm">{now.cta.label}</ButtonLink>}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <TaskEditor task={{ id: t.id, description: t.description ?? "", checklist: t.checklist ?? [], assignee: t.assignee_id, due: t.due_at, priority: t.priority, contentId: t.content_id }}
            canEditMeta={canManage} canEditBody={mine || canManage}
            members={[...members.values()].filter((m) => m.status === "active").map((m) => ({ id: m.user_id, name: m.full_name }))}
            comments={(comments ?? []).map((c) => ({ id: c.id as string, body: c.body as string, at: c.created_at as string, author: members.get(c.author_id as string)?.full_name ?? "—" }))} />
        </div>
        <aside className="space-y-4">
          <section aria-label="Resumo" className="rounded-lg border border-border bg-surface p-4">
            <dl className="space-y-2.5 text-[13px]">
              {facts.filter(([, v]) => v !== null).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3"><dt className="shrink-0 text-muted">{k}</dt><dd className="min-w-0 truncate text-right">{v}</dd></div>
              ))}
            </dl>
          </section>
          {sequence.length > 0 && (
            <section aria-labelledby="seq" className="rounded-lg border border-border bg-surface">
              <h2 id="seq" className="px-4 pb-1 pt-3 text-[13px] font-semibold">Sequência</h2>
              <ul className="pb-2">{sequence.map((d) => (
                <li key={`${d.rel}-${d.id}`}><Link href={`/app/tarefas/${d.id}`} className="flex items-center gap-2 px-4 py-1.5 text-[13px] hover:bg-surface-2">
                  <span className="w-12 shrink-0 text-xs text-subtle">{d.rel === "antes" ? "Antes" : "Depois"}</span>
                  <span className="min-w-0 flex-1 truncate">{d.title.split(" — ")[0]}</span>
                  <Badge tone={taskStatus[d.status].tone}>{taskStatus[d.status].label}</Badge>
                </Link></li>
              ))}</ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
