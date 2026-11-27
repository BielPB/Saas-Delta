"use client";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { clientHue } from "@/lib/client-color";
import { postStatusMeta, type PostStatusKey } from "@/lib/post-status";
import { EmptyState } from "@/components/ui/primitives";
import { StatusPill } from "@/app/app/clientes/[id]/post-grid";

/** One open post, with every date-dependent flag already computed on the server (same timezone for everyone). */
export interface DemandRow {
  id: string; title: string; href: string; clientId: string; clientName: string; format: string;
  status: PostStatusKey; due: string | null; late: boolean; today: boolean; week: boolean;
  dueLabel: { text: string; late: boolean } | null;
}

const ORDER: PostStatusKey[] = ["adjust", "editing", "capture", "script", "finishing", "client", "ready", "scheduled"];
type Filter = "atrasadas" | "hoje" | "semana" | "todas";

/**
 * Counters, client chips and "Por etapa / Por prazo" filter in the browser: instant, no server round trip.
 * The URL is kept in sync (shareable, survives a reload) with history.replaceState.
 */
export function Demands({ rows, initial, hasTasks }: {
  rows: DemandRow[];
  initial: { f: string | null; cliente: string | null; ordem: string | null };
  hasTasks: boolean;
}) {
  const [f, setF] = useState<Filter>(["atrasadas", "hoje", "semana"].includes(initial.f ?? "") ? (initial.f as Filter) : "todas");
  const [cliente, setCliente] = useState<string | null>(initial.cliente);
  const [byDeadline, setByDeadline] = useState(initial.ordem === "prazo");

  const sync = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    window.history.replaceState(null, "", `${window.location.pathname}${p.size ? `?${p}` : ""}`);
  };
  const pickFilter = (next: Filter) => { setF(next); setCliente(null); sync({ f: next === "todas" ? null : next, cliente: null }); };
  const pickClient = (id: string | null) => { setCliente(id); sync({ cliente: id }); };
  const pickOrder = (deadline: boolean) => { setByDeadline(deadline); sync({ ordem: deadline ? "prazo" : null }); };

  const counters: Array<{ key: Filter; label: string; n: number; danger?: boolean }> = [
    { key: "atrasadas", label: "Atrasadas", n: rows.filter((r) => r.late).length, danger: true },
    { key: "hoje", label: "Para hoje", n: rows.filter((r) => r.today).length },
    { key: "semana", label: "Próximos 7 dias", n: rows.filter((r) => r.week).length },
    { key: "todas", label: "Todas abertas", n: rows.length },
  ];
  const byFilter = rows.filter((r) => (f === "atrasadas" ? r.late : f === "hoje" ? r.today : f === "semana" ? r.week : true));
  const clientCounts = new Map<string, { name: string; n: number }>();
  for (const r of byFilter) clientCounts.set(r.clientId, { name: r.clientName, n: (clientCounts.get(r.clientId)?.n ?? 0) + 1 });
  const activeClient = cliente && clientCounts.has(cliente) ? cliente : null;
  const shown = activeClient ? byFilter.filter((r) => r.clientId === activeClient) : byFilter;

  const groups: Array<{ key: string; title: string; rows: DemandRow[] }> = byDeadline
    ? [
        { key: "late", title: "Atrasadas", rows: shown.filter((r) => r.late) },
        { key: "week", title: "Esta semana", rows: shown.filter((r) => !r.late && r.week) },
        { key: "later", title: "Mais adiante", rows: shown.filter((r) => !r.late && !r.week && r.due) },
        { key: "none", title: "Sem data", rows: shown.filter((r) => !r.due) },
      ]
    : ORDER.map((k) => ({ key: k, title: postStatusMeta[k].label, rows: shown.filter((r) => r.status === k) }));
  const sortByDue = (a: DemandRow, b: DemandRow) => ((a.due ?? "9") < (b.due ?? "9") ? -1 : 1);
  const chip = (on: boolean) => cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium pointer-coarse:py-1.5",
    on ? "border-accent bg-accent text-accent-fg" : "border-border text-muted hover:text-fg");

  return (
    <>
      <nav aria-label="Filtro por prazo" className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counters.map((c) => (
          <button key={c.key} type="button" onClick={() => pickFilter(c.key)} aria-pressed={f === c.key}
            className={cn("min-w-0 rounded-xl border bg-surface px-3 py-2.5 text-left transition-colors hover:border-border-strong sm:px-4 sm:py-3",
              f === c.key ? "border-accent-ink/70 ring-1 ring-accent-ink/30" : "border-border")}>
            <p className={cn("tabular text-2xl font-bold", c.danger && c.n > 0 && "text-[var(--tone-danger-fg)]")}>{c.n}</p>
            <p className="text-xs text-muted">{c.label}</p>
          </button>
        ))}
      </nav>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {/* Phones: client chips scroll sideways in one row instead of piling up. */}
        <div className="flex gap-1.5 max-sm:-mx-4 max-sm:w-[calc(100%+2rem)] max-sm:overflow-x-auto max-sm:px-4 max-sm:pb-1 sm:flex-wrap">
          <button type="button" onClick={() => pickClient(null)} aria-pressed={!activeClient} className={chip(!activeClient)}>
            Todos os clientes <span className="tabular opacity-70">{byFilter.length}</span>
          </button>
          {[...clientCounts.entries()].sort((a, b) => b[1].n - a[1].n).map(([id, c]) => (
            <button key={id} type="button" onClick={() => pickClient(id)} aria-pressed={activeClient === id} className={chip(activeClient === id)}>
              <span className="size-2 rounded-full" style={{ background: `hsl(${clientHue(c.name)} 60% 55%)` }} aria-hidden />{c.name} <span className="tabular opacity-70">{c.n}</span>
            </button>
          ))}
        </div>
        <div role="group" aria-label="Agrupar" className="flex rounded-lg border border-border bg-surface p-0.5 text-xs">
          {([[false, "Por etapa"], [true, "Por prazo"]] as const).map(([deadline, label]) => (
            <button key={label} type="button" onClick={() => pickOrder(deadline)} aria-pressed={byDeadline === deadline}
              className={cn("rounded-md px-2.5 py-1 text-muted pointer-coarse:py-2", byDeadline === deadline && "bg-surface-3 font-medium text-fg")}>{label}</button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <section className="rounded-xl border border-border bg-surface">
          <EmptyState compact title={rows.length ? "Nada neste filtro" : hasTasks ? "Nenhum post com você" : "Nenhuma demanda aberta"}
            description={rows.length ? "Troque o filtro acima para ver as outras demandas." : "Quando você for marcado como responsável ou editor de um post, ele aparece aqui."} />
        </section>
      ) : (
        <div className="space-y-5">
          {groups.filter((g) => g.rows.length > 0).map((g) => (
            <section key={g.key} aria-labelledby={`g-${g.key}`}>
              <h2 id={`g-${g.key}`} className="mb-1.5 flex items-baseline gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {g.title} <span className="tabular font-normal">{g.rows.length}</span>
              </h2>
              <ul className="space-y-1.5">
                {[...g.rows].sort(sortByDue).map((r) => {
                  const hue = clientHue(r.clientName);
                  return (
                    <li key={r.id}>
                      <Link href={r.href} className="flex items-center gap-3 rounded-lg border border-border bg-surface py-2.5 pr-3 transition-colors hover:border-border-strong">
                        <span className="h-9 w-1 shrink-0 rounded-r-full" style={{ background: `hsl(${hue} 60% 55%)` }} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block wrap-anywhere whitespace-normal text-[14px] font-semibold">{r.title}</span>
                          <span className="flex min-w-0 items-center gap-2 text-xs text-muted">
                            <span className="wrap-anywhere whitespace-normal" style={{ color: `hsl(${hue} 60% 62%)` }}>{r.clientName}</span>
                            <span className="shrink-0 rounded border border-border px-1.5 text-[10.5px] uppercase tracking-wide">{r.format}</span>
                            {byDeadline && <StatusPill s={r.status} />}
                          </span>
                        </span>
                        {r.dueLabel && <span className={cn("shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold", r.dueLabel.late ? "bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]" : "bg-surface-2 text-muted")}>{r.dueLabel.text}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
