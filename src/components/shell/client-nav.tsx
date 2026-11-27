"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { clientHue } from "@/lib/client-color";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Dialog, Menu, MenuItem, useToast } from "@/components/ui/overlay";
import { renameCategory, setClientCategory } from "@/app/app/clientes/actions";

export interface NavClient { id: string; name: string; status: string; category_id: string | null; open: number; logo: string | null }
export interface NavCategory { id: string; name: string; position: number }

export function ClientAvatar({ name, size = 24, src }: { name: string; size?: number; src?: string | null }) {
  const hue = clientHue(name);
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- signed private URL
    return <img src={src} alt="" aria-hidden className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.42), background: `hsl(${hue} 45% 22%)`, color: `hsl(${hue} 70% 78%)` }}>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function ClientNav({ categories, clients, canManage }: { categories: NavCategory[]; clients: NavClient[]; canManage: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [pending, start] = useTransition();
  const activeId = pathname.match(/^\/app\/clientes\/([0-9a-f-]{36})/)?.[1];

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const visible = clients.filter((c) => !needle || c.name.toLowerCase().includes(needle));
    const list = categories.map((cat) => ({ id: cat.id, name: cat.name, clients: visible.filter((c) => c.category_id === cat.id) }));
    const loose = visible.filter((c) => !c.category_id || !categories.some((cat) => cat.id === c.category_id));
    if (loose.length) list.unshift({ id: "none", name: "Sem categoria", clients: loose });
    return list.filter((g) => g.clients.length > 0); // empty folders only add noise
  }, [categories, clients, q]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => {
    const r = await fn();
    if (r.ok) { if (r.message) toast.success(r.message); router.refresh(); } else toast.error(r.error ?? "Erro.");
  });

  const saveName = () => {
    if (!renaming || !renaming.name.trim()) return;
    start(async () => {
      const r = await renameCategory(renaming.id, renaming.name);
      if (r.ok) { toast.success(r.message ?? "Categoria renomeada."); setRenaming(null); router.refresh(); } else toast.error(r.error ?? "Erro.");
    });
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between px-2">
        <Link href="/app/clientes" className="text-[11px] font-semibold uppercase tracking-wider text-subtle hover:text-fg">Clientes</Link>
        {canManage && (
          <Link href="/app/clientes/novo" aria-label="Novo cliente" className="flex size-6 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg">
            <Plus className="size-3.5" />
          </Link>
        )}
      </div>
      <label className="mx-1 mb-2 flex h-8 items-center gap-2 pointer-coarse:h-10 rounded-md border border-border bg-bg px-2 text-[13px] text-muted focus-within:border-border-strong">
        <Search className="size-3.5 shrink-0" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente…" aria-label="Buscar cliente"
          className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-subtle" />
      </label>

      <div className="space-y-1">
        {groups.length === 0 && <p className="px-2 py-1 text-xs text-subtle">{q ? "Nenhum cliente encontrado." : "Nenhum cliente ainda."}</p>}
        {groups.map((g) => {
          const isClosed = !q && groups.length > 1 && (closed[g.id] ?? false);
          return (
            <div key={g.id}>
              {groups.length > 1 && (
                <div className="group/cat flex items-center rounded-md">
                  <button type="button" onClick={() => setClosed((s) => ({ ...s, [g.id]: !isClosed }))} aria-expanded={!isClosed}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-subtle hover:text-fg">
                    {isClosed ? <ChevronRight className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden />}
                    <span className="truncate">{g.name}</span>
                    <span className="tabular font-normal">{g.clients.length}</span>
                  </button>
                  {canManage && g.id !== "none" && (
                    // "Sem categoria" is not a real folder: only real categories can be renamed.
                    <div className="hidden pr-1 group-hover/cat:block group-focus-within/cat:block pointer-coarse:block">
                      <Menu label={`Opções da categoria ${g.name}`} trigger={(p) => (
                        <button type="button" {...p} className="flex size-6 items-center justify-center rounded text-muted hover:text-fg pointer-coarse:size-9"><MoreHorizontal className="size-3.5" /></button>
                      )}>
                        {(close) => <MenuItem onSelect={() => { close(); setRenaming({ id: g.id, name: g.name }); }}>Renomear categoria</MenuItem>}
                      </Menu>
                    </div>
                  )}
                </div>
              )}
              {!isClosed && (
                <ul className="space-y-px">
                  {g.clients.map((c) => {
                    const on = c.id === activeId;
                    return (
                      <li key={c.id} className={cn("group relative flex items-center rounded-md", on ? "bg-surface-2" : "hover:bg-surface-2")}>
                        {on && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" aria-hidden />}
                        <Link href={`/app/clientes/${c.id}`} aria-current={on ? "page" : undefined}
                          className={cn("flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-[13px] pointer-coarse:py-2.5 pointer-coarse:text-sm", on ? "font-medium text-fg" : "text-muted hover:text-fg", c.status !== "active" && "opacity-60")}>
                          <ClientAvatar name={c.name} size={22} src={c.logo} />
                          <span className="truncate">{c.name}</span>
                          {c.open > 0 && <span className="tabular ml-auto text-[11px] text-subtle group-hover:hidden pointer-coarse:group-hover:inline">{c.open}</span>}
                        </Link>
                        {canManage && (
                          // No hover on touch screens: the "…" stays visible there.
                          <div className="hidden pr-1 group-hover:block group-focus-within:block pointer-coarse:block">
                            <Menu label={`Opções de ${c.name}`} trigger={(p) => (
                              <button type="button" {...p} className="flex size-6 items-center justify-center rounded text-muted hover:text-fg pointer-coarse:size-9"><MoreHorizontal className="size-3.5" /></button>
                            )}>
                              {(close) => (
                                <>
                                  <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">Mover para</p>
                                  {categories.filter((cat) => cat.id !== c.category_id).map((cat) => (
                                    <MenuItem key={cat.id} onSelect={() => { close(); run(() => setClientCategory(c.id, cat.id)); }}>{cat.name}</MenuItem>
                                  ))}
                                  {c.category_id && <MenuItem onSelect={() => { close(); run(() => setClientCategory(c.id, null)); }}>Sem categoria</MenuItem>}
                                </>
                              )}
                            </Menu>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {renaming && (
        <Dialog open size="sm" title="Renomear categoria" onClose={() => setRenaming(null)}
          footer={<>
            <Button onClick={() => setRenaming(null)}>Cancelar</Button>
            <Button variant="primary" disabled={pending || !renaming.name.trim()} onClick={() => saveName()}>Salvar</Button>
          </>}>
          <form onSubmit={(e) => { e.preventDefault(); saveName(); }}>
            <label className="block text-[13px] font-medium">Nome
              <Input className="mt-1" autoFocus maxLength={60} value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
            </label>
          </form>
        </Dialog>
      )}
    </div>
  );
}
