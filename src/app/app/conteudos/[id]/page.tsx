import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { assetSelect, contentSelect, memberMap, signPaths, taskSelect, type ContentRow, type DeliverableRow, type TaskRow } from "@/lib/data";
import { channels, priority as priorityLabel, stageLabel } from "@/lib/domain";
import { formatDateTime, relative } from "@/lib/format";
import { cn, isUuid } from "@/lib/utils";
import { activityText } from "@/lib/activity";
import { ChevronDown } from "lucide-react";
import { Avatar, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ServiceDot, StageBadge } from "@/components/content/badges";
import { TaskList } from "@/components/tasks/task-list";
import { ContentViewer, type ViewerDeliverable } from "./viewer";
import { CommentBox, ContentActions, DeliverablesManager, EditDetails } from "./panels";

export const metadata: Metadata = { title: "Conteúdo" };

export default async function ContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await getContext();
  const sb = await createClient();
  const { data: c } = await sb.from("content_items").select(`${contentSelect}, objective, description, briefing, script, publish_override_reason`)
    .eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!c) notFound();
  const content = c as unknown as ContentRow & { objective: string | null; description: string | null; briefing: string | null; script: string | null; publish_override_reason: string | null };

  const [{ data: dels }, { data: tasks }, { data: responses }, { data: comments }, { data: activity }, { data: revisions }, { data: assignees }, members, { data: services }] = await Promise.all([
    sb.from("deliverables").select(`id, kind, title, required, client_facing, approval_status, current_version_id, assignee_id, responsible_role_key, position,
      deliverable_versions!deliverable_versions_workspace_id_deliverable_id_fkey(id, version_number, text_content, external_url, status, change_reason, created_at, released_at, author_id,
        deliverable_version_assets(position, file_assets(${assetSelect})))`).eq("content_id", id).order("position"),
    sb.from("tasks").select(taskSelect).eq("content_id", id).order("created_at"),
    sb.from("approval_responses").select("id, version_id, decision, comment, reviewer_name, created_at").eq("content_id", id).order("created_at", { ascending: false }),
    sb.from("comments").select("id, body, author_id, created_at, version_id, task_id").eq("content_id", id).order("created_at"),
    sb.from("activity_logs").select("id, action, actor_type, actor_label, actor_id, data, created_at").eq("content_id", id).order("created_at", { ascending: false }).limit(60),
    sb.from("revision_requests").select("id, deliverable_id, version_id, reason, status, source, created_at").eq("content_id", id).order("created_at", { ascending: false }),
    sb.from("content_assignees").select("user_id").eq("content_id", id),
    memberMap(ctx.workspace.id),
    sb.from("client_services").select("id, name").eq("client_id", content.client_id).eq("active", true).order("name"),
  ]);

  const deliverables = ((dels ?? []) as unknown as DeliverableRow[]).map((d) => ({
    ...d, deliverable_versions: [...d.deliverable_versions].sort((a, b) => b.version_number - a.version_number),
  }));
  const allAssets = deliverables.flatMap((d) => d.deliverable_versions.flatMap((v) => v.deliverable_version_assets.map((x) => x.file_assets)));
  const urls = await signPaths(allAssets.flatMap((a) => [a.preview_path ?? a.storage_path, a.thumbnail_path]));
  const respByVersion = new Map<string, Array<{ decision: string; comment: string | null; reviewer_name: string | null; created_at: string }>>();
  for (const r of responses ?? []) respByVersion.set(r.version_id as string, [...(respByVersion.get(r.version_id as string) ?? []), r as never]);

  const viewer: ViewerDeliverable[] = deliverables.filter((d) => d.kind !== "script").map((d) => ({
    id: d.id, kind: d.kind, title: d.title, clientFacing: d.client_facing, approval: d.approval_status, currentVersionId: d.current_version_id,
    versions: d.deliverable_versions.map((v) => ({
      id: v.id, number: v.version_number, status: v.status, text: v.text_content, url: v.external_url, reason: v.change_reason,
      createdAt: v.created_at, released: Boolean(v.released_at), author: v.author_id ? members.get(v.author_id)?.full_name ?? null : null,
      decisions: respByVersion.get(v.id) ?? [],
      assets: [...v.deliverable_version_assets].sort((a, b) => a.position - b.position).map(({ file_assets: a }) => ({
        id: a.id, name: a.name, mime: a.mime_type, provider: a.provider, status: a.status, width: a.width, height: a.height,
        url: urls.get(a.preview_path ?? a.storage_path ?? "") ?? null, poster: a.thumbnail_path ? urls.get(a.thumbnail_path) ?? null : null,
        driveId: a.drive_file_id, externalUrl: a.external_url,
      })),
    })),
  }));

  const taskRows = (tasks ?? []) as unknown as TaskRow[];
  const script = deliverables.find((d) => d.kind === "script");
  const scriptText = script?.deliverable_versions[0]?.text_content ?? content.script;
  const canManage = ctx.can("contents.manage");
  const openRevisions = (revisions ?? []).filter((r) => r.status === "open");
  const openTasks = taskRows.filter((t) => !["done", "cancelled"].includes(t.status));
  const doneTasks = taskRows.filter((t) => ["done", "cancelled"].includes(t.status));
  const nextTask = openTasks.find((t) => t.status !== "blocked") ?? openTasks[0];
  const who = (uid: string | null | undefined) => (uid ? members.get(uid)?.full_name ?? "sem responsável" : "sem responsável");

  // One sentence that tells the team what happens next with this content.
  const next: { tone: "warning" | "accent" | "info" | "neutral" | "success"; title: string; text?: string; quotes?: Array<{ label: string; text: string }> } =
    content.stage === "adjustments" ? {
      tone: "warning", title: "O cliente pediu ajustes",
      text: "Envie uma nova versão do que foi reprovado e conclua as tarefas de ajuste. O item volta para o mesmo link de aprovação.",
      quotes: openRevisions.map((r) => ({ label: deliverables.find((x) => x.id === r.deliverable_id)?.title ?? "Item", text: r.reason as string })),
    } : content.stage === "client_approval" ? { tone: "info", title: "Aguardando o cliente", text: "O conteúdo está no link de aprovação. Você é avisado quando o cliente responder." }
    : content.stage === "internal_review" ? { tone: "info", title: "Falta a revisão interna", text: "Tudo foi enviado. A revisão interna libera o conteúdo para o cliente aprovar." }
    : content.stage === "ready" ? { tone: "accent", title: "Aprovado pelo cliente", text: "Registre a data de agendamento quando programar a publicação." }
    : content.stage === "scheduled" ? { tone: "accent", title: `Agendado para ${formatDateTime(content.scheduled_at)}`, text: "Confirme a publicação quando o post for ao ar." }
    : content.stage === "published" ? { tone: "success", title: `Publicado em ${formatDateTime(content.published_at)}` }
    : content.stage === "cancelled" ? { tone: "neutral", title: "Conteúdo cancelado" }
    : { tone: "neutral", title: `Em produção · ${stageLabel[content.stage]}`,
        text: nextTask ? `Próxima tarefa: ${nextTask.title} (${who(nextTask.assignee_id)}). ${openTasks.length} tarefa(s) em aberto.` : undefined };

  const facts: Array<[string, React.ReactNode]> = [
    ["Subdivisão", content.client_services ? <ServiceDot color={content.client_services.color} name={content.client_services.name} /> : null],
    ["Formato", content.content_formats?.name ?? null],
    ["Canal", content.channel ? channels[content.channel] : null],
    ["Prazo", content.due_at ? formatDateTime(content.due_at) : null],
    ["Postagem prevista", content.planned_publish_at ? formatDateTime(content.planned_publish_at) : null],
    ["Agendado para", content.scheduled_at ? formatDateTime(content.scheduled_at) : null],
    ["Publicado em", content.published_at ? formatDateTime(content.published_at) : null],
    ["Prioridade", ["high", "urgent"].includes(content.priority) ? priorityLabel[content.priority].label : null],
    ["Link", content.published_url ? <a className="underline underline-offset-2" href={content.published_url} target="_blank" rel="noreferrer noopener">abrir post</a> : null],
    ["Exceção", content.publish_override_reason ? <span className="text-[var(--tone-warning-fg)]">{content.publish_override_reason}</span> : null],
  ];
  const subtitle = [content.clients?.name, content.client_services?.name, content.content_formats?.name].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader
        eyebrow={<span className="flex items-center gap-1.5"><Link href="/app/conteudos" className="hover:text-fg">Conteúdos</Link><span>/</span>
          <Link href={`/app/clientes/${content.client_id}`} className="hover:text-fg">{content.clients?.name}</Link></span>}
        title={<span className="flex flex-wrap items-center gap-2"><span><span className="font-mono text-base text-subtle">#{content.code}</span> {content.title}</span><StageBadge s={content.stage} /></span>}
        description={subtitle}
        actions={<ContentActions content={{ id, code: content.code, title: content.title, publication: content.publication_status, approval: content.approval_status, planned: content.planned_publish_at, scheduled: content.scheduled_at, channel: content.channel }}
          can={{ manage: canManage, publish: ctx.can("publications.manage"), approvals: ctx.can("approvals.manage") }} clientId={content.client_id} />}
      />

      <section aria-label="O que fazer agora" className={cn("mb-4 rounded-lg border px-4 py-3",
        next.tone === "warning" ? "border-[var(--tone-warning-fg)]/40 bg-[var(--tone-warning-bg)]"
          : next.tone === "accent" ? "border-accent-ink/40 bg-accent-soft/50"
          : next.tone === "success" ? "border-[var(--tone-success-fg)]/30 bg-[var(--tone-success-bg)]"
          : "border-border bg-surface")}>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">O que fazer agora</p>
        <p className="mt-0.5 text-[15px] font-semibold">{next.title}</p>
        {next.text && <p className="mt-0.5 text-[13px] text-muted">{next.text}</p>}
        {next.quotes && next.quotes.length > 0 && (
          <ul className="mt-2 space-y-1">
            {next.quotes.map((q, i) => <li key={i} className="text-[13px]"><span className="font-medium">{q.label}:</span> <span className="text-muted">“{q.text}”</span></li>)}
          </ul>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <ContentViewer deliverables={viewer} aspect={content.content_formats?.aspect_ratio ?? "9:16"} />

          <section aria-labelledby="tarefas" className="rounded-lg border border-border bg-surface">
            <header className="flex items-center justify-between gap-3 px-4 py-3">
              <h2 id="tarefas" className="text-[13px] font-semibold">Tarefas em aberto <span className="tabular ml-1 font-normal text-muted">{openTasks.length}</span></h2>
            </header>
            <div className="border-t border-border">
              <TaskList tasks={openTasks} members={members} currentUser={ctx.user.id} canManage={ctx.can("tasks.manage")} empty="Nenhuma tarefa em aberto." />
            </div>
            {doneTasks.length > 0 && (
              <details className="group border-t border-border">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-xs font-medium text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
                  <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden /> Mostrar concluídas ({doneTasks.length})
                </summary>
                <div className="border-t border-border opacity-80">
                  <TaskList tasks={doneTasks} members={members} currentUser={ctx.user.id} canManage={ctx.can("tasks.manage")} />
                </div>
              </details>
            )}
          </section>

          <Collapsible title="Arquivos e versões" hint="Enviar nova versão, histórico de versões" defaultOpen={content.stage === "adjustments"}>
            <DeliverablesManager bare contentId={id} workspaceId={ctx.workspace.id} clientId={content.client_id} serviceId={content.service_id}
              canInvalidate={ctx.can("approvals.invalidate")} me={ctx.user.id}
              deliverables={deliverables.map((d) => ({
                id: d.id, kind: d.kind, title: d.title, approval: d.approval_status, required: d.required, clientFacing: d.client_facing,
                versions: d.deliverable_versions.length, current: d.deliverable_versions[0]?.version_number ?? 0,
                canUpload: canManage || d.assignee_id === ctx.user.id || taskRows.some((t) => t.deliverable_id === d.id && t.assignee_id === ctx.user.id && !["done", "cancelled"].includes(t.status)),
                lastText: d.deliverable_versions[0]?.text_content ?? null,
              }))} />
          </Collapsible>

          <Collapsible title="Comentários da equipe" count={(comments ?? []).length} hint="Só a equipe vê" defaultOpen={(comments ?? []).length > 0}>
            <div className="p-4">
              <ul className="mb-3 space-y-3">
                {(comments ?? []).length === 0 && <li className="text-sm text-muted">Nenhum comentário ainda.</li>}
                {(comments ?? []).map((cm) => {
                  const m = members.get(cm.author_id as string);
                  return (
                    <li key={cm.id as string} className="flex gap-2.5">
                      <Avatar name={m?.full_name} src={m?.avatar_url} size={26} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs"><span className="font-medium">{m?.full_name ?? "Ex-colaborador"}</span> <span className="text-subtle">{relative(cm.created_at as string)}</span></p>
                        <p className="whitespace-pre-wrap text-[13px]">{cm.body as string}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <CommentBox contentId={id} />
            </div>
          </Collapsible>
        </div>

        <aside className="space-y-4">
          <section aria-label="Informações" className="rounded-lg border border-border bg-surface p-4">
            <dl className="space-y-2.5 text-[13px]">
              {facts.filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-muted">{k}</dt><dd className="min-w-0 wrap-anywhere whitespace-normal text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <EditDetails canEdit={canManage} content={{
            id, lock: content.lock_version, title: content.title, objective: content.objective, briefing: content.briefing,
            description: content.description, priority: content.priority, due_at: content.due_at, planned_publish_at: content.planned_publish_at,
            channel: content.channel, service_id: content.service_id, published_url: content.published_url,
          }} services={(services ?? []) as Array<{ id: string; name: string }>}
            members={[...members.values()].filter((m) => m.status === "active").map((m) => ({ id: m.user_id, name: m.full_name }))}
            assignees={(assignees ?? []).map((a) => a.user_id as string)} />

          {scriptText && (
            <Collapsible title="Roteiro">
              <p className="max-h-72 overflow-y-auto whitespace-pre-wrap p-4 text-[13px] leading-relaxed">{scriptText}</p>
            </Collapsible>
          )}

          <Collapsible title="Histórico" count={(activity ?? []).length}>
            {(activity ?? []).length === 0 ? <EmptyState compact title="Sem registros" /> : (
              <ol className="max-h-96 divide-y divide-border overflow-y-auto">
                {(activity ?? []).map((ev) => (
                  <li key={ev.id as number} className="px-4 py-2 text-[12.5px]">
                    <span className="font-medium">{ev.actor_type === "client" ? `${String(ev.actor_label ?? "Cliente")} (cliente)` : members.get(ev.actor_id as string)?.full_name ?? "Sistema"}</span>{" "}
                    <span className="text-muted">{activityText(ev.action as string, ev.data as Record<string, unknown>)}</span>
                    <time className="block text-[11px] text-subtle" dateTime={ev.created_at as string}>{formatDateTime(ev.created_at as string)}</time>
                  </li>
                ))}
              </ol>
            )}
          </Collapsible>
        </aside>
      </div>
    </>
  );
}

/** Native <details>: collapsed sections keep the page short and work without JS. */
function Collapsible({ title, count, hint, defaultOpen, children }: { title: string; count?: number; hint?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-[13px] font-semibold">
          {title}{count !== undefined && <span className="tabular ml-1.5 font-normal text-muted">{count}</span>}
          {hint && <span className="ml-2 text-xs font-normal text-subtle">{hint}</span>}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-border">{children}</div>
    </details>
  );
}
