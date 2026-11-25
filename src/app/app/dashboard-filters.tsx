"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/form";

export function DashboardFilters({ clients, services, formats, members }: {
  clients: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string; client_id: string }>;
  formats: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v); else p.delete(k);
    if (k === "cliente") p.delete("servico");
    router.replace(`${path}?${p.toString()}`, { scroll: false });
  };
  const client = sp.get("cliente") ?? "";
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filtros do painel">
      <Select aria-label="Período" value={sp.get("periodo") ?? ""} onChange={(e) => set("periodo", e.target.value)} className="h-8 w-36 text-[13px]">
        <option value="">Este mês</option><option value="mes_anterior">Mês anterior</option><option value="30d">Últimos 30 dias</option>
        <option value="90d">Últimos 90 dias</option><option value="trimestre">Trimestre</option>
      </Select>
      <Select aria-label="Cliente" value={client} onChange={(e) => set("cliente", e.target.value)} className="h-8 w-40 text-[13px]">
        <option value="">Todos os clientes</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <Select aria-label="Serviço" value={sp.get("servico") ?? ""} onChange={(e) => set("servico", e.target.value)} className="h-8 w-36 text-[13px]">
        <option value="">Todos os serviços</option>
        {services.filter((s) => !client || s.client_id === client).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      <Select aria-label="Formato" value={sp.get("formato") ?? ""} onChange={(e) => set("formato", e.target.value)} className="h-8 w-36 text-[13px]">
        <option value="">Todos os formatos</option>{formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </Select>
      <Select aria-label="Colaborador" value={sp.get("colaborador") ?? ""} onChange={(e) => set("colaborador", e.target.value)} className="h-8 w-40 text-[13px]">
        <option value="">Toda a equipe</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </Select>
    </div>
  );
}
