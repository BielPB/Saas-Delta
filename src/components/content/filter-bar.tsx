"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { stages, approvalStatus, publicationStatus } from "@/lib/domain";

/**
 * URL-backed filters (shareable, back-button friendly) + persistence: the last
 * filter set per page is restored when the page is opened without filters.
 */
export function FilterBar({ clients, services, formats, members, show = ["q", "cliente", "servico", "formato", "etapa", "aprovacao", "publicacao", "responsavel", "ordem"] }: {
  clients: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string; client_id: string }>;
  formats: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
  show?: string[];
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const storageKey = `df-filters:${path}`;
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const keys = [...sp.keys()].filter((k) => k !== "visao");
    if (keys.length === 0) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) router.replace(`${path}?${saved}${sp.get("visao") ? `&visao=${sp.get("visao")}` : ""}`, { scroll: false });
      } catch {}
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (p: URLSearchParams) => {
    p.delete("pagina");
    const persist = new URLSearchParams(p); persist.delete("visao");
    try { localStorage.setItem(storageKey, persist.toString()); } catch {}
    router.replace(`${path}?${p.toString()}`, { scroll: false });
  };
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v); else p.delete(k);
    if (k === "cliente") p.delete("servico");
    apply(p);
  };
  useEffect(() => {
    const t = setTimeout(() => { if ((sp.get("q") ?? "") !== q) set("q", q.trim()); }, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const client = sp.get("cliente") ?? "";
  const active = [...sp.keys()].filter((k) => !["visao", "pagina"].includes(k)).length;
  const cls = "h-8 w-auto min-w-32 max-w-44 text-[13px]";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" role="search" aria-label="Filtros">
      {show.includes("q") && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-subtle" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Título ou #código" aria-label="Buscar" className="h-8 w-52 pl-8 text-[13px]" />
        </div>
      )}
      {show.includes("cliente") && (
        <Select aria-label="Cliente" value={client} onChange={(e) => set("cliente", e.target.value)} className={cls}>
          <option value="">Cliente</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      )}
      {show.includes("servico") && (
        <Select aria-label="Subdivisão" value={sp.get("servico") ?? ""} onChange={(e) => set("servico", e.target.value)} className={cls}>
          <option value="">Subdivisão</option>{services.filter((s) => !client || s.client_id === client).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      )}
      {show.includes("formato") && (
        <Select aria-label="Formato" value={sp.get("formato") ?? ""} onChange={(e) => set("formato", e.target.value)} className={cls}>
          <option value="">Formato</option>{formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
      )}
      {show.includes("etapa") && (
        <Select aria-label="Etapa" value={sp.get("etapa") ?? ""} onChange={(e) => set("etapa", e.target.value)} className={cls}>
          <option value="">Etapa</option>{stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>
      )}
      {show.includes("aprovacao") && (
        <Select aria-label="Aprovação" value={sp.get("aprovacao") ?? ""} onChange={(e) => set("aprovacao", e.target.value)} className={cls}>
          <option value="">Aprovação</option>{Object.entries(approvalStatus).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      )}
      {show.includes("publicacao") && (
        <Select aria-label="Publicação" value={sp.get("publicacao") ?? ""} onChange={(e) => set("publicacao", e.target.value)} className={cls}>
          <option value="">Publicação</option>{Object.entries(publicationStatus).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          <option value="late">Publicação atrasada</option>
        </Select>
      )}
      {show.includes("responsavel") && (
        <Select aria-label="Responsável" value={sp.get("responsavel") ?? ""} onChange={(e) => set("responsavel", e.target.value)} className={cls}>
          <option value="">Responsável</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
      )}
      {show.includes("ordem") && (
        <Select aria-label="Ordenar" value={sp.get("ordem") ?? ""} onChange={(e) => set("ordem", e.target.value)} className={cls}>
          <option value="">Atualizados recentemente</option><option value="publicacao">Data de postagem</option>
          <option value="prazo">Prazo de produção</option><option value="codigo">Código</option>
        </Select>
      )}
      {active > 0 && (
        <Button size="sm" variant="ghost" onClick={() => { setQ(""); const p = new URLSearchParams(); if (sp.get("visao")) p.set("visao", sp.get("visao")!); apply(p); }}>
          <X /> Limpar ({active})
        </Button>
      )}
    </div>
  );
}
