import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type {
  ApprovalStatus, ContentStage, DeliverableKind, Priority, ProductionStatus, PublicationStatus, TaskKind, TaskStatus, VersionStatus,
} from "@/lib/domain";
import { linkThumbnail } from "@/lib/media-link";
import { isUuid } from "@/lib/utils";

export const BUCKET = "workspace-files";
export const PAGE_SIZE = 50;

export interface ContentRow {
  id: string; code: number; title: string; client_id: string; service_id: string | null; format_id: string;
  priority: Priority; due_at: string | null; planned_publish_at: string | null; scheduled_at: string | null;
  published_at: string | null; published_url: string | null; channel: string | null;
  production_status: ProductionStatus; approval_status: ApprovalStatus; publication_status: PublicationStatus;
  stage: ContentStage; thumbnail_asset_id: string | null; created_at: string; updated_at: string; lock_version: number;
  work_status?: string; template_id?: string | null;
  clients: { name: string } | null;
  client_services: { name: string; color: string } | null;
  content_formats: { name: string; key: string; aspect_ratio: string | null } | null;
  thumbnail?: { storage_path: string | null; mime_type: string | null } | null;
}

export const contentSelect =
  "id, code, title, client_id, service_id, format_id, priority, due_at, planned_publish_at, scheduled_at, published_at, published_url, channel, " +
  "production_status, approval_status, publication_status, stage, thumbnail_asset_id, created_at, updated_at, lock_version, work_status, template_id, " +
  "clients(name), client_services(name, color), content_formats(name, key, aspect_ratio), thumbnail:file_assets!content_items_thumbnail_fk(storage_path, mime_type)";

export interface TaskRow {
  id: string; title: string; description: string | null; status: TaskStatus; kind: TaskKind; priority: Priority;
  due_at: string | null; assignee_id: string | null; client_id: string; content_id: string | null; deliverable_id: string | null;
  step_key: string | null; required_role_key: string | null; completed_at: string | null; created_at: string; reopen_count: number;
  checklist: Array<{ id: string; text: string; done: boolean }>;
  clients: { name: string } | null;
  content_items: { code: number; title: string } | null;
  deliverables: { kind: DeliverableKind; title: string; current_version_id: string | null } | null;
}
export const taskSelect =
  "id, title, description, status, kind, priority, due_at, assignee_id, client_id, content_id, deliverable_id, step_key, required_role_key, " +
  "completed_at, created_at, reopen_count, checklist, clients(name), content_items(code, title), deliverables(kind, title, current_version_id)";

export interface MemberRow { user_id: string; full_name: string; email: string | null; avatar_url: string | null; roles: string[]; status: string; member_id: string; invited_email: string | null; monthly_target: number | null }

export interface AssetRow {
  id: string; name: string; mime_type: string | null; provider: "supabase" | "drive" | "external_link";
  storage_path: string | null; preview_path: string | null; thumbnail_path: string | null; drive_file_id: string | null;
  external_url: string | null; size_bytes: number | null; width: number | null; height: number | null; status: string; category: string;
  client_id: string | null; service_id: string | null; created_at: string; last_seen_at: string | null;
}
export const assetSelect =
  "id, name, mime_type, provider, storage_path, preview_path, thumbnail_path, drive_file_id, external_url, size_bytes, width, height, status, category, client_id, service_id, created_at, last_seen_at";

export interface VersionRow {
  id: string; version_number: number; text_content: string | null; external_url: string | null; status: VersionStatus;
  change_reason: string | null; created_at: string; released_at: string | null; author_id: string | null;
  deliverable_version_assets: Array<{ position: number; file_assets: AssetRow }>;
}
export interface DeliverableRow {
  id: string; kind: DeliverableKind; title: string; required: boolean; client_facing: boolean; approval_status: VersionStatus;
  current_version_id: string | null; assignee_id: string | null; responsible_role_key: string | null; position: number;
  deliverable_versions: VersionRow[];
}

/* ------------------------------------------------------------------------- */
/* Filters (URL search params → validated filters, persisted via the URL)     */
/* ------------------------------------------------------------------------- */
const uuidOpt = z.string().optional().transform((v) => (isUuid(v) ? v : undefined));
export const contentFilters = z.object({
  q: z.string().max(80).optional(),
  cliente: uuidOpt, servico: uuidOpt, formato: uuidOpt, responsavel: uuidOpt,
  etapa: z.string().max(40).optional(),
  aprovacao: z.enum(["not_sent", "awaiting", "partially_approved", "rejected", "approved"]).optional().catch(undefined),
  publicacao: z.enum(["unscheduled", "planned", "ready", "scheduled", "published", "cancelled", "late"]).optional().catch(undefined),
  producao: z.enum(["planned", "in_production", "internal_review", "adjustments", "done"]).optional().catch(undefined),
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  arquivados: z.literal("1").optional().catch(undefined),
  ordem: z.enum(["recentes", "publicacao", "prazo", "codigo"]).optional().catch(undefined),
  pagina: z.coerce.number().int().min(1).max(1000).optional().catch(undefined),
  visao: z.enum(["lista", "tabela", "kanban", "galeria", "calendario"]).optional().catch(undefined),
});
export type ContentFilters = z.infer<typeof contentFilters>;

export function parseFilters<T extends z.ZodTypeAny>(schema: T, sp: Record<string, string | string[] | undefined>): z.infer<T> {
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const r = schema.safeParse(flat);
  return r.success ? r.data : schema.parse({});
}

export async function listContents(ws: string, f: ContentFilters, opts: { limit?: number } = {}) {
  const sb = await createClient();
  const limit = opts.limit ?? PAGE_SIZE;
  const page = f.pagina ?? 1;
  let q = sb.from("content_items").select(contentSelect, { count: "exact" }).eq("workspace_id", ws);
  q = f.arquivados ? q.not("archived_at", "is", null) : q.is("archived_at", null);
  if (f.cliente) q = q.eq("client_id", f.cliente);
  if (f.servico) q = q.eq("service_id", f.servico);
  if (f.formato) q = q.eq("format_id", f.formato);
  if (f.etapa) q = q.eq("stage", f.etapa);
  if (f.aprovacao) q = q.eq("approval_status", f.aprovacao);
  if (f.producao) q = q.eq("production_status", f.producao);
  if (f.publicacao === "late") {
    q = q.not("publication_status", "in", "(published,cancelled)").lt("planned_publish_at", new Date().toISOString());
  } else if (f.publicacao) q = q.eq("publication_status", f.publicacao);
  if (f.de) q = q.gte("planned_publish_at", `${f.de}T00:00:00-03:00`);
  if (f.ate) q = q.lte("planned_publish_at", `${f.ate}T23:59:59-03:00`);
  if (f.q) {
    const term = f.q.replace(/[%_,()]/g, " ").trim();
    const code = /^#?(\d+)$/.exec(term)?.[1];
    q = code ? q.eq("code", Number(code)) : q.ilike("title", `%${term}%`);
  }
  if (f.responsavel) {
    const { data: ids } = await sb.from("tasks").select("content_id").eq("workspace_id", ws).eq("assignee_id", f.responsavel).not("content_id", "is", null).limit(1000);
    const list = [...new Set((ids ?? []).map((r) => r.content_id as string))];
    q = q.in("id", list.length ? list : ["00000000-0000-0000-0000-000000000000"]);
  }
  switch (f.ordem) {
    case "publicacao": q = q.order("planned_publish_at", { ascending: true, nullsFirst: false }); break;
    case "prazo": q = q.order("due_at", { ascending: true, nullsFirst: false }); break;
    case "codigo": q = q.order("code", { ascending: false }); break;
    default: q = q.order("updated_at", { ascending: false });
  }
  q = q.range((page - 1) * limit, page * limit - 1);
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as ContentRow[], total: count ?? 0, page, limit };
}

/** Short-lived signed URLs (user JWT: storage RLS decides). Never cached publicly. */
export async function signPaths(paths: Array<string | null | undefined>, ttl = 900) {
  const list = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (!list.length) return new Map<string, string>();
  const sb = await createClient();
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(list, ttl);
  return new Map((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl as string]));
}

export async function thumbnails(rows: ContentRow[]) {
  const map = await signPaths(rows.map((r) => (r.thumbnail?.mime_type?.startsWith("image/") ? r.thumbnail.storage_path : null)));
  return (r: ContentRow) => (r.thumbnail?.storage_path ? map.get(r.thumbnail.storage_path) ?? null : null);
}

export async function listMembers(ws: string): Promise<MemberRow[]> {
  const sb = await createClient();
  const { data } = await sb.from("workspace_members")
    .select("id, user_id, status, invited_email, monthly_target, member_roles(roles(key, name))")
    .eq("workspace_id", ws).in("status", ["active", "invited", "disabled"]).order("created_at");
  const rows = (data ?? []) as unknown as Array<{ id: string; user_id: string | null; status: string; invited_email: string | null; monthly_target: number | null; member_roles: Array<{ roles: { key: string } | null }> }>;
  const ids = rows.map((r) => r.user_id).filter((x): x is string => Boolean(x));
  const { data: profiles } = ids.length ? await sb.from("profiles").select("id, full_name, email, avatar_url").in("id", ids) : { data: [] };
  const pm = new Map((profiles ?? []).map((p) => [p.id as string, p]));
  return rows.map((r) => {
    const p = r.user_id ? pm.get(r.user_id) : undefined;
    return {
      member_id: r.id, user_id: r.user_id ?? "", status: r.status, invited_email: r.invited_email,
      full_name: (p?.full_name as string) || (p?.email as string) || r.invited_email || "Convidado",
      email: (p?.email as string) ?? r.invited_email, avatar_url: (p?.avatar_url as string) ?? null,
      roles: r.member_roles.map((m) => m.roles?.key ?? "").filter(Boolean),
      monthly_target: r.monthly_target,
    };
  });
}

export async function memberMap(ws: string) {
  const m = await listMembers(ws);
  return new Map(m.filter((x) => x.user_id).map((x) => [x.user_id, x]));
}

export async function listClientsLite(ws: string) {
  const sb = await createClient();
  const { data } = await sb.from("clients").select("id, name, status, is_sensitive").eq("workspace_id", ws).neq("status", "archived").order("name");
  return (data ?? []) as Array<{ id: string; name: string; status: string; is_sensitive: boolean }>;
}

export async function listServicesLite(ws: string, client?: string) {
  const sb = await createClient();
  let q = sb.from("client_services").select("id, name, color, client_id, active").eq("workspace_id", ws).order("name");
  if (client) q = q.eq("client_id", client);
  const { data } = await q;
  return (data ?? []) as Array<{ id: string; name: string; color: string; client_id: string; active: boolean }>;
}

export async function listFormats(ws: string) {
  const sb = await createClient();
  const { data } = await sb.from("content_formats").select("id, key, name, required_kinds, aspect_ratio, active").eq("workspace_id", ws).order("name");
  return (data ?? []) as Array<{ id: string; key: string; name: string; required_kinds: DeliverableKind[]; aspect_ratio: string | null; active: boolean }>;
}

export async function listTemplates(ws: string) {
  const sb = await createClient();
  const { data } = await sb.from("content_templates").select("id, name, description, format_id, steps, active").eq("workspace_id", ws).order("name");
  return (data ?? []) as Array<{ id: string; name: string; description: string | null; format_id: string; active: boolean;
    steps: Array<{ key: string; title: string; role_key: string; deliverable_kind: DeliverableKind | null; depends_on: string[]; offset_days: number; kind: TaskKind }> }>;
}

export function qs(base: Record<string, string | number | undefined | null>, patch: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Per-content extras for the pipeline board: delivered/pending deliverables and assignees. */
export async function pipelineExtras(ws: string, contentIds: string[]) {
  const empty = { deliverables: new Map<string, Array<{ kind: DeliverableKind; done: boolean }>>(), assignees: new Map<string, string[]>() };
  if (!contentIds.length) return empty;
  const sb = await createClient();
  const [{ data: ds }, { data: as }] = await Promise.all([
    sb.from("deliverables").select("content_id, kind, current_version_id, position").eq("workspace_id", ws).in("content_id", contentIds).order("position"),
    sb.from("content_assignees").select("content_id, user_id").eq("workspace_id", ws).in("content_id", contentIds),
  ]);
  for (const d of (ds ?? []) as Array<{ content_id: string; kind: DeliverableKind; current_version_id: string | null }>) {
    empty.deliverables.set(d.content_id, [...(empty.deliverables.get(d.content_id) ?? []), { kind: d.kind, done: d.current_version_id !== null }]);
  }
  for (const a of (as ?? []) as Array<{ content_id: string; user_id: string }>) {
    empty.assignees.set(a.content_id, [...(empty.assignees.get(a.content_id) ?? []), a.user_id]);
  }
  return empty;
}

/** Sidebar: client categories (folders) and clients with their open-post counts. */
export async function clientNav(ws: string) {
  const sb = await createClient();
  const [{ data: cats }, { data: cls }, { data: open }] = await Promise.all([
    sb.from("client_categories").select("id, name, position").eq("workspace_id", ws).order("position").order("name"),
    sb.from("clients").select("id, name, status, category_id, logo_path").eq("workspace_id", ws).neq("status", "archived").order("name"),
    sb.from("content_items").select("client_id").eq("workspace_id", ws).not("stage", "in", "(published,cancelled)").limit(3000),
  ]);
  const count = new Map<string, number>();
  for (const o of (open ?? []) as Array<{ client_id: string }>) count.set(o.client_id, (count.get(o.client_id) ?? 0) + 1);
  const list = (cls ?? []) as Array<{ id: string; name: string; status: string; category_id: string | null; logo_path: string | null }>;
  const logos = await signPaths(list.map((c) => c.logo_path), 3600);
  return {
    categories: (cats ?? []) as Array<{ id: string; name: string; position: number }>,
    clients: list.map(({ logo_path, ...c }) => ({ ...c, open: count.get(c.id) ?? 0, logo: logo_path ? logos.get(logo_path) ?? null : null })),
  };
}

/**
 * Card thumbnails for the post grid: the first image of the current version of the
 * cover / art / carousel (or a video poster). Drive links are flagged so the card can show a play badge.
 */
export async function postThumbs(contentIds: string[]) {
  /** url: still image (art, cover, video poster or link thumbnail); video: signed video to show its first frame; link: media is an external link. */
  const out = new Map<string, { url: string | null; link: boolean; video: string | null }>();
  if (!contentIds.length) return out;
  const sb = await createClient();
  const { data: ds } = await sb.from("deliverables").select("content_id, kind, current_version_id").in("content_id", contentIds).not("current_version_id", "is", null);
  const rows = (ds ?? []) as Array<{ content_id: string; kind: string; current_version_id: string }>;
  const rank = (k: string) => ({ cover: 0, image: 1, carousel: 2, video: 3 } as Record<string, number>)[k] ?? 9;
  const best = new Map<string, { kind: string; version: string }>();
  for (const r of rows) {
    if (rank(r.kind) === 9) continue;
    const cur = best.get(r.content_id);
    if (!cur || rank(r.kind) < rank(cur.kind)) best.set(r.content_id, { kind: r.kind, version: r.current_version_id });
  }
  const versionIds = [...best.values()].map((b) => b.version);
  if (!versionIds.length) return out;
  const [{ data: assets }, { data: versions }] = await Promise.all([
    sb.from("deliverable_version_assets").select("version_id, position, file_assets(storage_path, preview_path, thumbnail_path, mime_type)").in("version_id", versionIds).order("position"),
    sb.from("deliverable_versions").select("id, external_url").in("id", versionIds),
  ]);
  const still = new Map<string, string>();
  const moving = new Map<string, string>();
  for (const a of (assets ?? []) as unknown as Array<{ version_id: string; file_assets: { storage_path: string | null; preview_path: string | null; thumbnail_path: string | null; mime_type: string | null } | null }>) {
    if (still.has(a.version_id) || moving.has(a.version_id) || !a.file_assets) continue;
    const f = a.file_assets;
    if (f.mime_type?.startsWith("image/")) { const p = f.thumbnail_path ?? f.storage_path; if (p) still.set(a.version_id, p); }
    else if (f.thumbnail_path) still.set(a.version_id, f.thumbnail_path);
    else if (f.mime_type?.startsWith("video/") && (f.preview_path ?? f.storage_path)) moving.set(a.version_id, (f.preview_path ?? f.storage_path)!);
  }
  const ext = new Map(((versions ?? []) as Array<{ id: string; external_url: string | null }>).map((v) => [v.id, v.external_url]));
  const signed = await signPaths([...still.values(), ...moving.values()]);
  for (const [content, b] of best) {
    const p = still.get(b.version);
    const v = moving.get(b.version);
    const link = ext.get(b.version) ?? null;
    out.set(content, {
      url: p ? signed.get(p) ?? null : !v && link ? linkThumbnail(link) : null,
      video: v ? signed.get(v) ?? null : null,
      link: !p && !v && Boolean(link),
    });
  }
  return out;
}

/**
 * Why a post cannot go to the client yet (same rules as submit_for_approval):
 * required files missing, or an adjustment the client asked for without a newer version.
 */
export async function postBlockers(contentIds: string[]) {
  const out = new Map<string, { missing: string[]; adjust: string[] }>();
  if (!contentIds.length) return out;
  const sb = await createClient();
  const [{ data: dels }, { data: revs }] = await Promise.all([
    sb.from("deliverables").select("id, content_id, title, required, current_version_id, deliverable_versions!deliverables_current_version_fk(version_number)").in("content_id", contentIds),
    sb.from("revision_requests").select("content_id, deliverable_id, version_id").in("content_id", contentIds).eq("status", "open"),
  ]);
  const revList = (revs ?? []) as Array<{ content_id: string; deliverable_id: string; version_id: string }>;
  const { data: rv } = revList.length ? await sb.from("deliverable_versions").select("id, version_number").in("id", revList.map((r) => r.version_id)) : { data: [] };
  const rejectedNumber = new Map(((rv ?? []) as Array<{ id: string; version_number: number }>).map((v) => [v.id, v.version_number]));
  const ds = (dels ?? []) as unknown as Array<{ id: string; content_id: string; title: string; required: boolean; current_version_id: string | null; deliverable_versions: { version_number: number } | null }>;
  const get = (id: string) => out.get(id) ?? out.set(id, { missing: [], adjust: [] }).get(id)!;
  for (const d of ds) if (d.required && !d.current_version_id) get(d.content_id).missing.push(d.title);
  for (const r of revList) {
    const d = ds.find((x) => x.id === r.deliverable_id);
    if (d && (d.deliverable_versions?.version_number ?? 0) <= (rejectedNumber.get(r.version_id) ?? 0)) get(r.content_id).adjust.push(d.title);
  }
  return out;
}

/** Open posts for pickers ("Post (opcional)" in Nova tarefa). */
export async function openPostsLite(ws: string) {
  const sb = await createClient();
  const { data } = await sb.from("content_items").select("id, client_id, code, title").eq("workspace_id", ws).is("archived_at", null)
    .not("stage", "in", "(published,cancelled)").order("planned_publish_at", { ascending: true, nullsFirst: false }).limit(500);
  return ((data ?? []) as Array<{ id: string; client_id: string; code: number; title: string }>).map((p) => ({ id: p.id, client_id: p.client_id, label: `#${p.code} ${p.title}` }));
}
