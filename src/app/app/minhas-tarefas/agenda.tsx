import Link from "next/link";
import { after } from "next/server";
import { CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { integrations } from "@/lib/env";
import { calendarToken, listEvents, type GEvent } from "@/lib/calendar/google";
import { syncCalendar } from "@/lib/calendar/sync";
import { AgendaEvent } from "./agenda-event";
import { ScheduleCalendar } from "@/components/ui/schedule-calendar";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import { formatGroups } from "@/lib/post-status";

/**
 * "Agenda" strip: the next 7 days from the person's Google Agenda.
 * Others' agendas show only when they chose to share; private events show as "Ocupado".
 * Visiting your own page also keeps your agenda in sync (at most every 10 minutes).
 */
export async function AgendaStrip({ ws, uid, isSelf, tz, origin }: { ws: string; uid: string; isSelf: boolean; tz: string; origin: string }) {
  if (!integrations.calendar()) return null;
  const admin = createAdminClient();
  const { data: conn } = await admin.from("calendar_connections").select("id, status, share_with_team, last_synced_at").eq("workspace_id", ws).eq("user_id", uid).maybeSingle();

  if (!conn) {
    return isSelf ? (
      <section className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 py-3">
        <p className="text-[13px] text-muted"><CalendarDays className="mr-1.5 inline size-4" aria-hidden />Conecte o Google Agenda para ver seus compromissos aqui e receber os prazos na sua agenda.</p>
        <Link href="/app/conta" className="text-[13px] font-medium text-accent-ink hover:underline">Conectar →</Link>
      </section>
    ) : null;
  }
  if (!isSelf && !conn.share_with_team) return null;
  if (isSelf && conn.status !== "revoked" && (!conn.last_synced_at || new Date().getTime() - new Date(conn.last_synced_at).getTime() > 10 * 60_000)) {
    after(() => syncCalendar(conn.id as string, origin).catch(() => {}));
  }

  const today = toLocalInput(new Date().toISOString(), tz).slice(0, 10);
  // Advance calendar dates before converting local midnight to instants (including DST).
  const dates = Array.from({ length: 8 }, (_, i) => new Date(Date.parse(today) + i * 864e5));
  const isoDates = dates.map(date => date.toISOString().slice(0, 10));
  const bounds = isoDates.map(date => fromLocalInput(`${date}T00:00`, tz)!);
  let events: GEvent[] = [];
  let failed = false;
  try {
    events = await listEvents(await calendarToken(conn.id as string), bounds[0], bounds[7]);
  } catch { failed = true; }

  // Events Delta Flow created point back to the task / post; other events open in Google Agenda.
  const visibleIds = events.filter((e) => isSelf || !["private", "confidential"].includes(e.visibility ?? "")).map((e) => e.id);
  const { data: links } = visibleIds.length
    ? await admin.from("calendar_event_links").select("google_event_id, source_type, source_id").eq("connection_id", conn.id as string).in("google_event_id", visibleIds)
    : { data: [] };
  const linkByEvent = new Map(((links ?? []) as Array<{ google_event_id: string; source_type: string; source_id: string }>).map((l) => [l.google_event_id, l]));
  const linked = [...linkByEvent.values()];
  const postIds = linked.filter((l) => l.source_type === "post").map((l) => l.source_id);
  const taskIds = linked.filter((l) => l.source_type === "task").map((l) => l.source_id);
  const sb = await createClient();
  const [{ data: posts }, { data: tasks }] = await Promise.all([
    postIds.length ? sb.from("content_items").select("id, client_id, planned_publish_at, created_at, briefing, content_formats(key)").eq("workspace_id", ws).in("id", postIds) : { data: [] },
    taskIds.length ? sb.from("tasks").select("id, description").eq("workspace_id", ws).in("id", taskIds) : { data: [] },
  ]);
  const notes = new Map<string, string | null>([
    ...(posts ?? []).map((p) => [p.id, p.briefing] as const),
    ...(tasks ?? []).map((t) => [t.id, t.description] as const),
  ]);
  const postHref = new Map(((posts ?? []) as unknown as Array<{ id: string; client_id: string; planned_publish_at: string | null; created_at: string; content_formats: { key: string } | null }>).map((p) => {
    const g = formatGroups.find((x) => x.formats.includes(p.content_formats?.key ?? ""))?.key ?? "posts";
    return [p.id, `/app/clientes/${p.client_id}?aba=${g}&mes=${(p.planned_publish_at ?? p.created_at).slice(0, 7)}&post=${p.id}`];
  }));
  const target = (e: GEvent, priv: boolean): { href: string; internal: boolean; note?: string | null } | null => {
    if (priv) return null;
    const l = linkByEvent.get(e.id);
    if (l && notes.has(l.source_id)) {
      const href = l.source_type === "task" ? `/app/tarefas/${l.source_id}` : postHref.get(l.source_id);
      if (href) return { href, internal: true, note: notes.get(l.source_id) };
    }
    if (!isSelf || !e.htmlLink) return null; // someone else's own events stay read-only
    return { href: e.htmlLink, internal: false };
  };

  const time = (iso: string) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
  const days = dates.slice(0, 7).map((date, i) => {
    const iso = isoDates[i];
    const list = events.filter(e => {
      if (e.start.date) return e.start.date <= iso && (e.end.date ? iso < e.end.date : iso === e.start.date);
      if (!e.start.dateTime) return false;
      const start = Date.parse(e.start.dateTime);
      const end = e.end.dateTime ? Date.parse(e.end.dateTime) : start;
      return start < Date.parse(bounds[i + 1]) && Math.max(end, start + 1) > Date.parse(bounds[i]);
    });
    const label = date.toLocaleDateString("pt-BR", { dateStyle: "full", timeZone: "UTC" });
    return {
      iso, label, weekday: date.toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" }).replace(".", ""),
      month: date.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }),
      count: list.length,
      events: list.map((e, index) => <EventItem key={index} e={e} isSelf={isSelf} day={label} time={time} target={target} />),
    };
  });
  return <ScheduleCalendar key={`${uid}-${today}`} days={days} failed={failed}/>;
}

function EventItem({ e, isSelf, day, time, target }: {
  e: GEvent; isSelf: boolean; day: string; time: (iso: string) => string;
  target: (e: GEvent, priv: boolean) => { href: string; internal: boolean; note?: string | null } | null;
}) {
  const priv = !isSelf && (e.visibility === "private" || e.visibility === "confidential");
  const t = target(e, priv);
  const title = priv ? "Ocupado" : e.summary ?? "(sem título)";
  return <AgendaEvent title={title} day={day} time={e.start.dateTime ? [e.start.dateTime, e.end.dateTime].filter((v): v is string => Boolean(v)).map(time).join(" – ") : "Dia todo"}
    description={priv ? "Compromisso privado." : t?.note?.trim() || e.description} location={priv ? undefined : e.location} target={t} />;
}
