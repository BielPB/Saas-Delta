"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/overlay";
import { Badge } from "@/components/ui/primitives";
import { channels, editorialStatus, type ApprovalStatus, type PublicationStatus } from "@/lib/domain";
import { DEFAULT_TZ, formatTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { movePublication } from "@/app/app/conteudos/actions";
import { PublicationDialog } from "@/components/content/publication-dialog";
import { Thumb } from "@/components/content/content-table";

export interface CalItem {
  id: string; code: number; title: string; client: string; at: string | null; color: string | null; thumb: string | null;
  publication_status: PublicationStatus; approval_status: ApprovalStatus; planned_publish_at: string | null; scheduled_at: string | null;
  channel: string | null; format: string; caption?: string | null;
}

type Mode = "mes" | "semana" | "dia" | "lista";
const dayKey = (iso: string) => toLocalInput(iso).slice(0, 10);
const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

export function CalendarMonth({ items, canEdit, initialDate, initialMode = "mes" }: {
  items: CalItem[]; canEdit: boolean; initialDate?: string; initialMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [cursor, setCursor] = useState(() => (initialDate ? new Date(`${initialDate}T12:00:00`) : new Date()));
  const [drag, setDrag] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ mode: "schedule" | "confirm"; item: CalItem } | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const byDay = useMemo(() => {
    const m = new Map<string, CalItem[]>();
    for (const i of items) if (i.at) { const k = dayKey(i.at); m.set(k, [...(m.get(k) ?? []), i].sort((a, b) => (a.at! < b.at! ? -1 : 1))); }
    return m;
  }, [items]);
  const undated = items.filter((i) => !i.at && i.publication_status !== "cancelled");

  // Conflicts: same client with two posts on the same day.
  const conflicts = useMemo(() => {
    const s = new Set<string>();
    for (const [, list] of byDay) {
      const seen = new Map<string, string>();
      for (const i of list) { if (seen.has(i.client)) { s.add(i.id); s.add(seen.get(i.client)!); } else seen.set(i.client, i.id); }
    }
    return s;
  }, [byDay]);

  const days = useMemo(() => {
    if (mode === "dia") return [new Date(cursor)];
    if (mode === "semana") { const s = addDays(cursor, -cursor.getDay()); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const s = addDays(first, -first.getDay());
    const weeks = Math.ceil((first.getDay() + new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => addDays(s, i));
  }, [cursor, mode]);

  const shift = (dir: number) => {
    const d = new Date(cursor);
    if (mode === "mes" || mode === "lista") d.setMonth(d.getMonth() + dir);
    else d.setDate(d.getDate() + dir * (mode === "semana" ? 7 : 1));
    setCursor(d);
  };

  const drop = (day: string) => {
    const it = items.find((x) => x.id === drag);
    setDrag(null);
    if (!it || !canEdit) return;
    if (["published", "cancelled"].includes(it.publication_status)) { toast.info("Conteúdo publicado ou cancelado não pode ser movido."); return; }
    const time = it.at ? toLocalInput(it.at).slice(11) : "09:00";
    const iso = fromLocalInput(`${day}T${time}`)!;
    start(async () => {
      const r = await movePublication(it.id, iso);
      if (r.ok) { toast.success(it.publication_status === "scheduled" ? "Publicação reprogramada. Atualize também na plataforma externa." : "Data editorial atualizada."); router.refresh(); }
      else toast.error(r.error);
    });
  };

  const rawTitle = new Intl.DateTimeFormat("pt-BR", mode === "dia" ? { dateStyle: "full", timeZone: DEFAULT_TZ } : { month: "long", year: "numeric" }).format(cursor);
  const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
  const today = ymd(new Date());

  const Card = ({ i, dense }: { i: CalItem; dense?: boolean }) => {
    const e = editorialStatus(i);
    return (
      <div draggable={canEdit && !["published", "cancelled"].includes(i.publication_status)} onDragStart={() => setDrag(i.id)}
        className={cn("group rounded-sm border border-border bg-surface text-left", dense ? "px-1.5 py-1" : "p-2", conflicts.has(i.id) && "border-[var(--tone-warning-fg)]/60")}>
        <Link href={`/app/conteudos/${i.id}`} className="flex items-start gap-1.5" draggable={false}>
          <span className="mt-1 size-1.5 shrink-0 rounded-full" style={{ background: i.color ?? "var(--fg-subtle)" }} aria-hidden />
          {!dense && <Thumb url={i.thumb} className="w-7" />}
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate font-medium", dense ? "text-[11.5px]" : "text-[13px]")}>
              {i.at && <span className="tabular mr-1 text-subtle">{formatTime(i.at)}</span>}{i.title}
            </span>
            {!dense && <span className="block truncate text-xs text-muted">{i.client} · {i.format}{i.channel ? ` · ${channels[i.channel]}` : ""}</span>}
          </span>
        </Link>
        {!dense && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <Badge tone={e.tone} dot={e.late}>{e.label}</Badge>
            {conflicts.has(i.id) && <Badge tone="warning">Conflito</Badge>}
            {canEdit && i.publication_status === "ready" && <button type="button" className="text-xs font-medium text-accent-ink hover:underline" onClick={() => setDialog({ mode: "schedule", item: i })}>Agendar</button>}
            {canEdit && i.publication_status === "scheduled" && <button type="button" className="text-xs font-medium text-accent-ink hover:underline" onClick={() => setDialog({ mode: "confirm", item: i })}>Confirmar publicação</button>}
            {i.caption && <button type="button" className="text-xs text-muted hover:text-fg" aria-label="Copiar legenda"
              onClick={() => navigator.clipboard.writeText(i.caption!).then(() => toast.success("Legenda copiada."))}><Copy className="inline size-3" /></button>}
          </div>
        )}
      </div>
    );
  };

  const listItems = items.filter((i) => i.at && dayKey(i.at).slice(0, 7) === ymd(cursor).slice(0, 7)).sort((a, b) => (a.at! < b.at! ? -1 : 1));

  return (
    <div aria-busy={pending}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="icon-sm" onClick={() => shift(-1)} aria-label="Anterior"><ChevronLeft /></Button>
        <Button size="icon-sm" onClick={() => shift(1)} aria-label="Próximo"><ChevronRight /></Button>
        <Button size="sm" onClick={() => setCursor(new Date())}>Hoje</Button>
        <h2 className="ml-1 text-[15px] font-semibold">{title}</h2>
        <div className="flex-1" />
        <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Visualização do calendário">
          {(["mes", "semana", "dia", "lista"] as Mode[]).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} type="button" onClick={() => setMode(m)}
              className={cn("h-7 rounded-sm px-2.5 text-[13px] text-muted", mode === m && "bg-surface-2 font-medium text-fg")}>
              {{ mes: "Mês", semana: "Semana", dia: "Dia", lista: "Lista" }[m]}
            </button>
          ))}
        </div>
      </div>

      {mode === "lista" ? (
        <div className="rounded-lg border border-border bg-surface">
          {listItems.length === 0 ? <p className="p-6 text-center text-sm text-muted">Nenhuma publicação neste mês.</p> : (
            <ul className="divide-y divide-border">{listItems.map((i) => <li key={i.id} className="p-2"><Card i={i} /></li>)}</ul>
          )}
        </div>
      ) : (
        <div className={cn("grid overflow-hidden rounded-lg border border-border bg-border gap-px", mode === "dia" ? "grid-cols-1" : "grid-cols-7")}>
          {mode !== "dia" && WEEK.map((w) => <div key={w} className="bg-surface-2 px-2 py-1 text-[11px] font-medium text-muted">{w}</div>)}
          {days.map((d) => {
            const k = ymd(d);
            const list = byDay.get(k) ?? [];
            const out = mode === "mes" && d.getMonth() !== cursor.getMonth();
            return (
              <div key={k} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(k)}
                className={cn("bg-surface p-1.5", mode === "mes" ? "min-h-28" : "min-h-64", out && "bg-surface-2/60")}>
                <div className={cn("mb-1 flex size-6 items-center justify-center rounded-full text-xs tabular", k === today ? "bg-accent font-semibold text-accent-fg" : out ? "text-subtle" : "text-muted")}>
                  {d.getDate()}
                </div>
                <div className="space-y-1">
                  {(mode === "mes" ? list.slice(0, 3) : list).map((i) => <Card key={i.id} i={i} dense={mode === "mes"} />)}
                  {mode === "mes" && list.length > 3 && (
                    <button type="button" className="px-1 text-[11px] text-muted hover:text-fg" onClick={() => { setCursor(d); setMode("dia"); }}>+{list.length - 3} mais</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {undated.length > 0 && (
        <details className="mt-4 rounded-lg border border-border bg-surface">
          <summary className="cursor-pointer px-4 py-2 text-[13px] font-medium">Sem data definida ({undated.length}) — arraste para um dia</summary>
          <ul className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">{undated.slice(0, 40).map((i) => <li key={i.id}><Card i={i} /></li>)}</ul>
        </details>
      )}

      {dialog && (
        <PublicationDialog mode={dialog.mode} onClose={() => setDialog(null)} defaults={{ at: dialog.item.at, channel: dialog.item.channel }}
          content={{ id: dialog.item.id, label: `#${dialog.item.code} ${dialog.item.title}`, approved: dialog.item.approval_status === "approved" }} />
      )}
    </div>
  );
}
