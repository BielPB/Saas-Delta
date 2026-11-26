import Link from "next/link";
import { after } from "next/server";
import { CalendarDays } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { integrations } from "@/lib/env";
import { calendarToken, listEvents, type GEvent } from "@/lib/calendar/google";
import { syncCalendar } from "@/lib/calendar/sync";
import { cn } from "@/lib/utils";

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
                {list.slice(0, 4).map((e) => {
                  const priv = !isSelf && (e.visibility === "private" || e.visibility === "confidential");
                  return (
                    <li key={e.id} className="rounded-md border-l-2 border-accent-ink/60 bg-surface-2 px-1.5 py-1 text-[11.5px] leading-tight" title={priv ? "Ocupado" : e.summary}>
                      <span className="tabular text-subtle">{e.start.dateTime ? time(e.start.dateTime) : "Dia todo"}</span>
                      <span className="block truncate">{priv ? "Ocupado" : e.summary ?? "(sem título)"}</span>
                    </li>
                  );
                })}
                {list.length > 4 && <li className="text-[11px] text-subtle">+{list.length - 4}</li>}
                {list.length === 0 && <li className="text-[11px] text-subtle">—</li>}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
