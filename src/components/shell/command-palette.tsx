"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Building2, CheckSquare, Film, FileIcon, Layers, Loader2, Search, Stamp, User } from "lucide-react";
import { searchAction } from "@/app/app/actions";
import { cn } from "@/lib/utils";

type Hit = { kind: string; id: string; title: string; subtitle: string | null; href: string };
const kindIcon: Record<string, React.ReactNode> = {
  client: <Building2 />, content: <Film />, task: <CheckSquare />, service: <Layers />, file: <FileIcon />,
  member: <User />, approval: <Stamp />,
};
const kindLabel: Record<string, string> = {
  client: "Clientes", content: "Conteúdos", task: "Tarefas", service: "Subdivisões", file: "Arquivos", member: "Colaboradores", approval: "Aprovações",
};
const quick: Hit[] = [
  { kind: "content", id: "n1", title: "Criar conteúdo", subtitle: null, href: "/app/conteudos/novo" },
  { kind: "client", id: "n2", title: "Cadastrar cliente", subtitle: null, href: "/app/clientes/novo" },
  { kind: "approval", id: "n3", title: "Gerar link de aprovação", subtitle: null, href: "/app/aprovacoes/novo" },
  { kind: "task", id: "n4", title: "Minhas tarefas", subtitle: null, href: "/app/minhas-tarefas" },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const close = () => { setQ(""); setHits([]); setActive(0); setLoading(false); onClose(); };

  useEffect(() => {
    if (q.trim().length < 2) return;
    let alive = true;
    const t = setTimeout(async () => {
      const res = await searchAction(q);
      if (!alive) return;
      setHits(res);
      setActive(0);
      setLoading(false);
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const onQuery = (v: string) => {
    setQ(v);
    if (v.trim().length < 2) { setHits([]); setLoading(false); } else setLoading(true);
  };

  const list = q.trim().length < 2 ? quick : hits;
  const go = (h: Hit) => { close(); router.push(h.href); };

  const groups = list.reduce<Record<string, Hit[]>>((acc, h) => { (acc[h.kind] ??= []).push(h); return acc; }, {});
  let idx = -1;

  return (
    <dialog ref={ref} onClose={close} onClick={(e) => { if (e.target === ref.current) close(); }}
      aria-label="Busca global"
      className="mx-auto mt-[calc(0.75rem+env(safe-area-inset-top))] w-[calc(100%-1.5rem)] max-w-xl sm:mt-[12vh] rounded-lg border border-border bg-surface p-0 text-fg shadow-pop">
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-4 text-subtle" aria-hidden />
        <input autoFocus value={q} onChange={(e) => onQuery(e.target.value)} placeholder="Buscar por nome, código (#12), cliente…"
          aria-label="Termo de busca" role="combobox" aria-expanded={list.length > 0} aria-controls="df-search-results"
          aria-activedescendant={list[active] ? `hit-${list[active].id}` : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, list.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === "Enter" && list[active]) { e.preventDefault(); go(list[active]); }
          }}
          className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle" />
        {loading && <Loader2 className="size-4 animate-spin text-subtle" aria-hidden />}
      </div>
      <div id="df-search-results" role="listbox" className="max-h-[50dvh] overflow-y-auto p-1.5">
        {q.trim().length >= 2 && !loading && hits.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted">Nada encontrado para “{q}”.</p>
        )}
        {Object.entries(groups).map(([kind, items]) => (
          <div key={kind} className="mb-1">
            <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-subtle">
              {q.trim().length < 2 ? "Ações rápidas" : kindLabel[kind]}
            </p>
            {items.map((h) => {
              idx++;
              const i = idx;
              return (
                <button key={h.id} id={`hit-${h.id}`} role="option" aria-selected={i === active} type="button"
                  onMouseEnter={() => setActive(i)} onClick={() => go(h)}
                  className={cn("flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm pointer-coarse:py-3 [&_svg]:size-4 [&_svg]:text-subtle",
                    i === active && "bg-surface-2")}>
                  {kindIcon[h.kind]}
                  <span className="min-w-0 flex-1 wrap-anywhere whitespace-normal">{h.title}</span>
                  {h.subtitle && <span className="max-w-[40%] wrap-anywhere whitespace-normal text-xs text-muted">{h.subtitle}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </dialog>
  );
}
