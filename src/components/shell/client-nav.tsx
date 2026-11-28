"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MoreHorizontal, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { clientHue } from "@/lib/client-color";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Dialog, Menu, MenuItem, useToast } from "@/components/ui/overlay";
import { renameClient, deleteClient } from "@/app/app/clientes/actions";

export interface NavClient { id: string; name: string; status: string; open: number; logo: string | null }

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

export function ClientNav({ clients, canManage }: { clients: NavClient[]; canManage: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<NavClient | null>(null);
  const [pending, start] = useTransition();
  const activeId = pathname.match(/^\/app\/clientes\/([0-9a-f-]{36})/)?.[1];

  const needle = q.trim().toLocaleLowerCase("pt-BR");
  const visible = clients.filter((client) => client.name.toLocaleLowerCase("pt-BR").includes(needle));

  const saveName = () => {
    if (!renaming || !renaming.name.trim()) return;
    start(async () => {
      const r = await renameClient(renaming.id, renaming.name);
      if (r.ok) { toast.success(r.message ?? "Cliente renomeado."); setRenaming(null); router.refresh(); } else toast.error(r.error ?? "Erro.");
    });
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between px-2">
        <Link href="/app/clientes" className="df-press text-[11px] font-semibold uppercase tracking-wider text-subtle hover:text-fg">Clientes</Link>
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

      {visible.length === 0 && <p className="px-2 py-1 text-xs text-muted">{needle ? "Nenhum cliente encontrado." : "Nenhum cliente ainda."}</p>}
      <ul aria-label="Clientes" className="space-y-0.5">
        {visible.map((c) => {
          const on = c.id === activeId;
          return (
            <li key={c.id} className={cn("group relative flex items-center rounded-md", on ? "bg-surface-2" : "hover:bg-surface-2")}>
              {on && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" aria-hidden />}
              <Link href={`/app/clientes/${c.id}`} aria-current={on ? "page" : undefined}
                className={cn("df-press flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-[13px] pointer-coarse:py-2.5 pointer-coarse:text-sm", on ? "font-medium text-fg" : "text-muted hover:text-fg", c.status !== "active" && "opacity-60")}>
                <ClientAvatar name={c.name} size={22} src={c.logo} />
                <span className="wrap-anywhere whitespace-normal">{c.name}</span>
                {c.open > 0 && <span title={`${c.open} conteúdos em aberto`} aria-label={`${c.open} conteúdos em aberto`} className="tabular ml-auto rounded px-1.5 text-[11px] text-muted">{c.open}</span>}
              </Link>
              {canManage && (
                <div className="shrink-0 pr-1">
                  <Menu label={`Opções de ${c.name}`} trigger={(p) => (
                    <button type="button" {...p} className="flex size-6 items-center justify-center rounded text-muted hover:text-fg pointer-coarse:size-9"><MoreHorizontal className="size-3.5" /></button>
                  )}>
                    {(close) => (
                      <>
                        <MenuItem onSelect={() => { close(); setRenaming({ id: c.id, name: c.name }); }}>Renomear cliente</MenuItem>
                        <MenuItem danger onSelect={() => { close(); setDeleting(c); }}>Excluir cliente</MenuItem>
                      </>
                    )}
                  </Menu>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {deleting && (
        <Dialog open size="sm" title="Excluir cliente" onClose={() => setDeleting(null)}
          footer={<>
            <Button disabled={pending} onClick={() => setDeleting(null)}>Cancelar</Button>
            <Button variant="danger" disabled={pending} onClick={() => start(async () => {
              const r = await deleteClient(deleting.id);
              if (!r.ok) { toast.error(r.error); return; }
              toast.success("Cliente excluído.");
              setDeleting(null);
              if (activeId === deleting.id) router.replace("/app/clientes");
              else router.refresh();
            })}>Excluir cliente</Button>
          </>}>
          <p className="text-sm">Excluir <strong>{deleting.name}</strong> do CRM? Os links de aprovação desse cliente serão desativados.</p>
        </Dialog>
      )}
      {renaming && (
        <Dialog open size="sm" title="Renomear cliente" onClose={() => setRenaming(null)}
          footer={<>
            <Button onClick={() => setRenaming(null)}>Cancelar</Button>
            <Button variant="primary" disabled={pending || !renaming.name.trim()} onClick={() => saveName()}>Salvar</Button>
          </>}>
          <form onSubmit={(e) => { e.preventDefault(); saveName(); }}>
            <label className="block text-[13px] font-medium">Nome
              <Input className="mt-1" autoFocus maxLength={160} value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
            </label>
          </form>
        </Dialog>
      )}
    </div>
  );
}
