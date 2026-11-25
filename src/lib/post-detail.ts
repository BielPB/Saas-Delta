import "server-only";
import { createClient } from "@/lib/supabase/server";
import { assetSelect, contentSelect, postBlockers, signPaths, type ContentRow, type DeliverableRow, type MemberRow } from "@/lib/data";
import type { ViewerDeliverable } from "@/app/app/conteudos/[id]/viewer";

export type PostDetail = Awaited<ReturnType<typeof loadPostDetail>>;

/** Everything the post side panel needs, read through RLS. Returns null if the member cannot see the post. */
export async function loadPostDetail(ws: string, id: string, members: Map<string, MemberRow>, me: string, can: { manage: boolean; submit: boolean }) {
  const sb = await createClient();
  const { data: c } = await sb.from("content_items").select(`${contentSelect}, briefing, objective, work_status, editor_id`)
    .eq("id", id).eq("workspace_id", ws).maybeSingle();
  if (!c) return null;
  const content = c as unknown as ContentRow & { briefing: string | null; objective: string | null; work_status: string; editor_id: string | null };

  const [{ data: dels }, { data: responses }, { data: comments }, { data: assignees }, { data: tasks }] = await Promise.all([
    sb.from("deliverables").select(`id, kind, title, required, client_facing, approval_status, current_version_id, assignee_id, responsible_role_key, position,
      deliverable_versions!deliverable_versions_workspace_id_deliverable_id_fkey(id, version_number, text_content, external_url, status, change_reason, created_at, released_at, author_id,
        deliverable_version_assets(position, file_assets(${assetSelect})))`).eq("content_id", id).order("position"),
    sb.from("approval_responses").select("version_id, decision, comment, reviewer_name, created_at").eq("content_id", id).order("created_at", { ascending: false }),
    sb.from("comments").select("id, body, author_id, created_at").eq("content_id", id).order("created_at"),
    sb.from("content_assignees").select("user_id").eq("content_id", id),
    sb.from("tasks").select("id, title, kind, deliverable_id, assignee_id, status, due_at").eq("content_id", id).order("created_at"),
  ]);
  const deliverables = ((dels ?? []) as unknown as DeliverableRow[]).map((d) => ({
    ...d, deliverable_versions: [...d.deliverable_versions].sort((a, b) => b.version_number - a.version_number),
  }));
  const allAssets = deliverables.flatMap((d) => d.deliverable_versions.flatMap((v) => v.deliverable_version_assets.map((x) => x.file_assets)));
  const urls = await signPaths(allAssets.flatMap((a) => [a.preview_path ?? a.storage_path, a.thumbnail_path]));
  const respByVersion = new Map<string, Array<{ decision: string; comment: string | null; reviewer_name: string | null; created_at: string }>>();
  for (const r of responses ?? []) respByVersion.set(r.version_id as string, [...(respByVersion.get(r.version_id as string) ?? []), r as never]);
  const assigneeIds = (assignees ?? []).map((a) => a.user_id as string);
  const taskRows = (tasks ?? []) as Array<{ id: string; title: string; kind: string; deliverable_id: string | null; assignee_id: string | null; status: string; due_at: string | null }>;

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

  const isPerson = content.editor_id === me || assigneeIds.includes(me);
  const managerItems = deliverables.map((d) => ({
    id: d.id, kind: d.kind, title: d.title, approval: d.approval_status, required: d.required, clientFacing: d.client_facing,
    versions: d.deliverable_versions.length, current: d.deliverable_versions[0]?.version_number ?? 0,
    canUpload: can.manage || isPerson || d.assignee_id === me || taskRows.some((t) => t.deliverable_id === d.id && t.assignee_id === me && !["done", "cancelled"].includes(t.status)),
    lastText: d.deliverable_versions[0]?.text_content ?? null,
  }));
  const missing = deliverables.filter((d) => d.required && !d.current_version_id).map((d) => d.title);
  const adjust = (await postBlockers([id])).get(id)?.adjust ?? [];

  return {
    content, viewer, managerItems, missing, adjust, assigneeIds,
    tasks: taskRows.filter((t) => t.status !== "cancelled").map((t) => ({ id: t.id, title: t.title, status: t.status, due: t.due_at, who: t.assignee_id ? members.get(t.assignee_id)?.full_name ?? "Ex-colaborador" : null, whoAvatar: t.assignee_id ? members.get(t.assignee_id)?.avatar_url ?? null : null })),
    canEdit: can.manage || isPerson, canSubmit: can.submit,
    comments: (comments ?? []).map((cm) => {
      const m = members.get(cm.author_id as string);
      return { id: cm.id as string, body: cm.body as string, at: cm.created_at as string, author: m?.full_name ?? "Ex-colaborador", avatar: m?.avatar_url ?? null };
    }),
  };
}
