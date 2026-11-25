import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { calendarToken, deleteEvent, upsertEvent, type EventBody } from "./google";

type Conn = { id: string; workspace_id: string; user_id: string; push_tasks: boolean; push_posts: boolean; status: string };
const MAX_OPS = 60;
const hash = (b: EventBody) => createHash("sha1").update(JSON.stringify(b)).digest("hex");
const plus = (iso: string, min: number) => new Date(new Date(iso).getTime() + min * 60_000).toISOString();

/**
 * Mirrors the person's deadlines into their Google Agenda:
 *   - open tasks assigned to them with a due date ("Tarefa: …", 30 min before the deadline);
 *   - publication dates of posts where they are responsible or editor ("Publicação: …").
 * Window: yesterday → 60 days. Unchanged events are skipped (payload hash); events whose
 * source is gone, done or out of the window are deleted. Uses the service role after the
 * caller resolved which connection to sync.
 */
export async function syncCalendar(connectionId: string, origin: string) {
  const admin = createAdminClient();
  const { data: c } = await admin.from("calendar_connections").select("id, workspace_id, user_id, push_tasks, push_posts, status").eq("id", connectionId).single();
  const conn = c as Conn | null;
  if (!conn || conn.status === "revoked") return { created: 0, updated: 0, deleted: 0 };
  const token = await calendarToken(conn.id);
  const from = new Date(Date.now() - 864e5).toISOString();
  const to = new Date(Date.now() + 60 * 864e5).toISOString();

  const wanted = new Map<string, EventBody>(); // key "task:<id>" | "post:<id>"
  if (conn.push_tasks) {
    const { data: tasks } = await admin.from("tasks").select("id, title, due_at, clients(name)")
      .eq("workspace_id", conn.workspace_id).eq("assignee_id", conn.user_id).not("status", "in", "(done,cancelled)")
      .gte("due_at", from).lte("due_at", to).limit(200);
    for (const t of (tasks ?? []) as unknown as Array<{ id: string; title: string; due_at: string; clients: { name: string } | null }>) {
      wanted.set(`task:${t.id}`, {
        summary: `Tarefa: ${t.title}${t.clients?.name ? ` · ${t.clients.name}` : ""}`,
        description: `Prazo da tarefa no Delta Flow.\n${origin}/app/tarefas/${t.id}`,
        start: { dateTime: plus(t.due_at, -30) }, end: { dateTime: t.due_at },
      });
    }
  }
  if (conn.push_posts) {
    const { data: mine } = await admin.from("content_assignees").select("content_id").eq("workspace_id", conn.workspace_id).eq("user_id", conn.user_id);
    const ids = (mine ?? []).map((m) => m.content_id as string);
    let q = admin.from("content_items").select("id, title, client_id, scheduled_at, planned_publish_at, publication_status, clients(name)")
      .eq("workspace_id", conn.workspace_id).is("archived_at", null).not("publication_status", "in", "(published,cancelled)").limit(300);
    q = ids.length ? q.or(`editor_id.eq.${conn.user_id},id.in.(${ids.join(",")})`) : q.eq("editor_id", conn.user_id);
    const { data: posts } = await q;
    for (const p of (posts ?? []) as unknown as Array<{ id: string; title: string; client_id: string; scheduled_at: string | null; planned_publish_at: string | null; publication_status: string; clients: { name: string } | null }>) {
      const at = p.scheduled_at ?? p.planned_publish_at;
      if (!at || at < from || at > to) continue;
      wanted.set(`post:${p.id}`, {
        summary: `${p.publication_status === "scheduled" ? "Publicação agendada" : "Publicação"}: ${p.clients?.name ?? ""} · ${p.title}`,
        description: `Data de publicação no Delta Flow.\n${origin}/app/conteudos/${p.id}`,
        start: { dateTime: at }, end: { dateTime: plus(at, 30) },
      });
    }
  }

  const { data: links } = await admin.from("calendar_event_links").select("source_type, source_id, google_event_id, payload_hash").eq("connection_id", conn.id);
  const existing = new Map(((links ?? []) as Array<{ source_type: string; source_id: string; google_event_id: string; payload_hash: string }>).map((l) => [`${l.source_type}:${l.source_id}`, l]));
  let ops = 0; let created = 0; let updated = 0; let deleted = 0;

  for (const [key, body] of wanted) {
    if (ops >= MAX_OPS) break;
    const h = hash(body);
    const link = existing.get(key);
    if (link && link.payload_hash === h) continue;
    const [type, id] = key.split(":");
    const eventId = await upsertEvent(token, link?.google_event_id ?? null, body);
    await admin.from("calendar_event_links").upsert({ connection_id: conn.id, source_type: type, source_id: id, google_event_id: eventId, payload_hash: h, updated_at: new Date().toISOString() });
    if (link) updated++; else created++;
    ops++;
  }
  for (const [key, link] of existing) {
    if (wanted.has(key) || ops >= MAX_OPS) continue;
    await deleteEvent(token, link.google_event_id);
    await admin.from("calendar_event_links").delete().eq("connection_id", conn.id).eq("source_type", link.source_type).eq("source_id", link.source_id);
    deleted++; ops++;
  }
  await admin.from("calendar_connections").update({ last_synced_at: new Date().toISOString(), status: "active", last_error: null }).eq("id", conn.id);
  return { created, updated, deleted };
}

/** Deletes every event Delta Flow created for this connection (used when disconnecting). */
export async function removeCreatedEvents(connectionId: string) {
  const admin = createAdminClient();
  const token = await calendarToken(connectionId).catch(() => null);
  if (!token) return;
  const { data: links } = await admin.from("calendar_event_links").select("google_event_id").eq("connection_id", connectionId).limit(500);
  for (const l of links ?? []) await deleteEvent(token, l.google_event_id as string).catch(() => {});
}

/** Syncs one person's agenda if they connected it (used right after task changes). Never throws. */
export async function syncPersonIfConnected(workspaceId: string, userId: string | null | undefined, origin: string) {
  if (!userId) return;
  try {
    const { data } = await createAdminClient().from("calendar_connections").select("id").eq("workspace_id", workspaceId).eq("user_id", userId).eq("status", "active").maybeSingle();
    if (data?.id) await syncCalendar(data.id as string, origin);
  } catch { /* the daily cron and the next visit retry */ }
}
