"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProjectNode { id: string; name: string; count: number; services: Array<{ id: string; name: string; count: number }> }

/** Sidebar "Projetos": cliente → subdivisões (serviços), cada um abre o pipeline filtrado. */
export function ProjectTree({ projects, canManage }: { projects: ProjectNode[]; canManage: boolean }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const onPipeline = pathname.startsWith("/app/pipeline");
  const activeClient = onPipeline ? sp.get("cliente") : null;
  const activeService = onPipeline ? sp.get("servico") : null;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (projects.length === 0) return null;

  return (
    <div>
      <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Projetos</p>
      <ul className="space-y-1">
        {projects.map((c) => {
          const isActive = activeClient === c.id;
          const expanded = open[c.id] ?? isActive;
          return (
            <li key={c.id}>
              <div className={cn("flex items-center rounded-xl border transition-colors",
                isActive ? "border-accent-ink/70 bg-accent-soft/40" : "border-transparent hover:bg-surface-2")}>
                <Link href={`/app/pipeline?cliente=${c.id}`} aria-current={isActive && !activeService ? "page" : undefined}
                  className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-[14px] font-semibold">
                  <span className={cn("size-2.5 shrink-0 rounded-full border-2", isActive ? "border-accent bg-accent" : "border-subtle")} aria-hidden />
                  <span className="truncate">{c.name}</span>
                </Link>
                <button type="button" onClick={() => setOpen((o) => ({ ...o, [c.id]: !expanded }))}
                  aria-expanded={expanded} aria-label={`${expanded ? "Recolher" : "Expandir"} ${c.name}`}
                  className="mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:text-fg">
                  {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </button>
              </div>

              {expanded && (
                <ul className="ml-4 mt-1 space-y-1 border-l border-border pl-2">
                  {c.services.map((s) => {
                    const on = isActive && activeService === s.id;
                    return (
                      <li key={s.id}>
                        <Link href={`/app/pipeline?cliente=${c.id}&servico=${s.id}`} aria-current={on ? "page" : undefined}
                          className={cn("flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-[14px] transition-colors",
                            on ? "bg-accent font-semibold text-accent-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                          <span className="truncate">{s.name}</span>
                          <span className={cn("tabular flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold",
                            on ? "bg-carbon text-lime" : "border border-border-strong text-muted")}>{s.count}</span>
                        </Link>
                      </li>
                    );
                  })}
                  {canManage && (
                    <li>
                      <Link href={`/app/clientes/${c.id}`}
                        className="flex items-center gap-2 rounded-xl border border-dashed border-border-strong px-3 py-2 text-[13px] font-semibold text-accent-ink hover:bg-surface-2">
                        <Plus className="size-4" aria-hidden /> Nova subdivisão
                      </Link>
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
