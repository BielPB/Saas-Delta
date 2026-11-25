import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { assetSelect, contentSelect, memberMap, signPaths, taskSelect, type ContentRow, type DeliverableRow, type TaskRow } from "@/lib/data";
import { channels, priority as priorityLabel } from "@/lib/domain";
import { formatDateTime, relative } from "@/lib/format";
import { isUuid } from "@/lib/utils";
import { activityText } from "@/lib/activity";
import { Avatar, EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { ApprovalBadge, ProductionBadge, PublicationBadge, ServiceDot, StageBadge } from "@/components/content/badges";
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

  return (
    <>
      <PageHeader
        eyebrow={<span className="flex items-center gap-1.5"><Link href="/app/conteudos" className="hover:text-fg">Conteúdos</Link><span>/</span>
          <Link href={`/app/clientes/${content.client_id}`} className="hover:text-fg">{content.clients?.name}</Link></span>}
        title={<span><span className="font-mono text-base text-subtle">#{content.code}</span> {content.title}</span>}
        actions={<ContentActions content={{ id, code: content.code, title: content.title, publication: content.publication_status, approval: content.approval_status, planned: content.planned_publish_at, scheduled: content.scheduled_at, channel: content.channel }}
          can={{ manage: canManage, publish: ctx.can("publications.manage"), approvals: ctx.can("approvals.manage") }} clientId={content.client_id} />}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <ContentViewer deliverables={viewer} aspect={content.content_formats?.aspect_ratio ?? "9:16"} />

          {openRevisions.length > 0 && (
            <Panel title="Ajustes em aberto" className="border-[var(--tone-warning-fg)]/30">
              <ul className="space-y-2">
                {openRevisions.map((r) => {
                  const d = deliverables.find((x) => x.id === r.deliverable_id);
                  return (
                    <li key={r.id as string} className="text-[13px]">
                      <span className="font-medium">{d?.title}</span> <span className="text-muted">· {r.source === "client" ? "pedido do cliente" : "invalidação interna"} · {relative(r.created_at as string)}</span>
                      <p className="mt-0.5 rounded-sm bg-surface-2 px-2 py-1.5">“{r.reason as string}”</p>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}

          <DeliverablesManager contentId={id} workspaceId={ctx.workspace.id} clientId={content.client_id} serviceId={content.service_id}
            canInvalidate={ctx.can("approvals.invalidate")} me={ctx.user.id}
            deliverables={deliverables.map((d) => ({
              id: d.id, kind: d.kind, title: d.title, approval: d.approval_status, required: d.required, clientFacing: d.client_facing,
              versions: d.deliverable_versions.length, current: d.deliverable_versions[0]?.version_number ?? 0,
              canUpload: canManage || d.assignee_id === ctx.user.id || taskRows.some((t) => t.deliverable_id === d.id && t.assignee_id === ctx.user.id && !["done", "cancelled"].includes(t.status)),
              lastText: d.deliverable_versions[0]?.text_content ?? null,
            }))} />

          <Panel title="Tarefas do conteúdo" padded={false}>
            <TaskList tasks={taskRows} members={members} currentUser={ctx.user.id} canManage={ctx.can("tasks.manage")} empty="Este conteúdo não tem tarefas." />
          </Panel>

          <Panel title="Comentários internos">
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
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel title="Status">
            <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-[13px]">
              <dt className="text-muted">Etapa</dt><dd><StageBadge s={content.stage} /></dd>
              <dt className="text-muted">Produção</dt><dd><ProductionBadge s={content.production_status} /></dd>
              <dt className="text-muted">Aprovação</dt><dd><ApprovalBadge s={content.approval_status} /></dd>
              <dt className="text-muted">Publicação</dt><dd><PublicationBadge c={content} /></dd>
              <dt className="text-muted">Serviço</dt><dd><ServiceDot color={content.client_services?.color} name={content.client_services?.name} /></dd>
              <dt className="text-muted">Formato</dt><dd>{content.content_formats?.name} <span className="text-subtle">{content.content_formats?.aspect_ratio}</span></dd>
              <dt className="text-muted">Canal</dt><dd>{content.channel ? channels[content.channel] : "—"}</dd>
              <dt className="text-muted">Prioridade</dt><dd>{priorityLabel[content.priority].label}</dd>
              <dt className="text-muted">Prazo</dt><dd>{formatDateTime(content.due_at)}</dd>
              <dt className="text-muted">Postagem prevista</dt><dd>{formatDateTime(content.planned_publish_at)}</dd>
              {content.scheduled_at && <><dt className="text-muted">Agendado para</dt><dd>{formatDateTime(content.scheduled_at)}</dd></>}
              {content.published_at && <><dt className="text-muted">Publicado em</dt><dd>{formatDateTime(content.published_at)}</dd></>}
              {content.published_url && <><dt className="text-muted">Link</dt><dd className="truncate"><a className="underline underline-offset-2" href={content.published_url} target="_blank" rel="noreferrer noopener">{content.published_url}</a></dd></>}
              {content.publish_override_reason && <><dt className="text-muted">Exceção</dt><dd className="text-[var(--tone-warning-fg)]">{content.publish_override_reason}</dd></>}
            </dl>
          </Panel>

          <EditDetails canEdit={canManage} content={{
            id, lock: content.lock_version, title: content.title, objective: content.objective, briefing: content.briefing,
            description: content.description, priority: content.priority, due_at: content.due_at, planned_publish_at: content.planned_publish_at,
            channel: content.channel, service_id: content.service_id, published_url: content.published_url,
          }} services={(services ?? []) as Array<{ id: string; name: string }>}
            members={[...members.values()].filter((m) => m.status === "active").map((m) => ({ id: m.user_id, name: m.full_name }))}
            assignees={(assignees ?? []).map((a) => a.user_id as string)} />

          {scriptText && (
            <Panel title="Roteiro"><p className="max-h-72 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed">{scriptText}</p></Panel>
          )}

          <Panel title="Histórico" padded={false}>
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
          </Panel>
        </aside>
      </div>
    </>
  );
}
