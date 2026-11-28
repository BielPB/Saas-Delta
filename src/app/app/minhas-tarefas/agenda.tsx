import Link from "next/link";
import { after } from "next/server";
import { CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { integrations } from "@/lib/env";
import { calendarToken, listEvents, type GEvent } from "@/lib/calendar/google";
import { syncCalendar } from "@/lib/calendar/sync";
import { AgendaEvent } from "./agenda-event";
import { cn } from "@/lib/utils";
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

  const start = new Date(); start.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 864e5));
  let events: GEvent[] = [];
  let failed = false;
  try {
    events = await listEvents(await calendarToken(conn.id as string), start.toISOString(), new Date(start.getTime() + 7 * 864e5).toISOString());
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

  const dayKey = (d: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(typeof d === "string" ? new Date(d) : d);
  const time = (iso: string) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
  const label = (d: Date, i: number) => (i === 0 ? "Hoje" : new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: tz }).format(d).replace(".", ""));
  const byDay = (d: Date) => events.filter((e) => (e.start.dateTime ? dayKey(e.start.dateTime) : e.start.date) === dayKey(d));

  return (
    <section aria-label="Agenda" className="mb-5 rounded-xl border border-border bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted"><CalendarDays className="size-3.5" aria-hidden /> Agenda</h2>
        <span className="text-[11px] text-subtle">{failed ? "Não foi possível ler o Google Agenda agora" : "Google Agenda"}</span>
      </header>
      {/* Phones: the 7 days scroll sideways in one strip (was 4 tall rows). */}
      <ol className="flex snap-x divide-x divide-border overflow-x-auto overscroll-x-contain sm:grid sm:grid-cols-4 sm:divide-x-0 sm:overflow-visible lg:grid-cols-7 lg:divide-x">
        {days.map((d, i) => {
          const list = byDay(d);
          return (
            <li key={i} className={cn("min-h-24 w-[42%] shrink-0 snap-start px-2.5 py-2 sm:w-auto", i === 0 && "bg-accent-soft/40")}>
              <p className="mb-1.5 flex items-baseline gap-1.5">
                <span className={cn("text-[11px] font-semibold uppercase", i === 0 ? "text-accent-ink" : "text-muted")}>{label(d, i)}</span>
                <span className="tabular text-xs text-subtle">{new Intl.DateTimeFormat("pt-BR", { day: "2-digit", timeZone: tz }).format(d)}</span>
              </p>
              <ul className="space-y-1">
                {list.slice(0, 4).map((e) => <EventItem key={e.id} e={e} isSelf={isSelf} day={new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: tz }).format(d)} time={time} target={target} />)}
                {list.length > 4 && (
                  <li>
                    <details className="group">
                      <summary className="cursor-pointer list-none text-[11px] font-medium text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
                        <span className="group-open:hidden">+{list.length - 4} mais</span><span className="hidden group-open:inline">mostrar menos</span>
                      </summary>
                      <ul className="mt-1 space-y-1">{list.slice(4).map((e) => <EventItem key={e.id} e={e} isSelf={isSelf} day={new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: tz }).format(d)} time={time} target={target} />)}</ul>
                    </details>
                  </li>
                )}
                {list.length === 0 && <li className="text-[11px] text-subtle">—</li>}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function EventItem({ e, isSelf, day, time, target }: {
  e: GEvent; isSelf: boolean; day: string; time: (iso: string) => string;
  target: (e: GEvent, priv: boolean) => { href: string; internal: boolean; note?: string | null } | null;
}) {
  const priv = !isSelf && (e.visibility === "private" || e.visibility === "confidential");
  const t = target(e, priv);
  const title = priv ? "Ocupado" : e.summary ?? "(sem título)";
  return <AgendaEvent title={title} day={day} time={e.start.dateTime ? time(e.start.dateTime) : "Dia todo"}
    description={priv ? "Compromisso privado." : t?.note?.trim() || e.description} location={priv ? undefined : e.location} target={t} />;
}
