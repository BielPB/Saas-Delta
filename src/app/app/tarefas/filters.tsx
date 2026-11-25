"use client";
import { useRouter, useSearchParams } from "next/navigation";

/** Selects apply on change (no "Filtrar" button). "Sem responsável" lives here instead of a separate tab. */
export function TaskFilters({ clients, members }: { clients: Array<{ id: string; name: string }>; members: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const sp = useSearchParams();
  const go = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    p.delete("pagina");
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const s = p.toString();
    router.push(`/app/tarefas${s ? `?${s}` : ""}`);
  };
  const who = sp.get("situacao") === "sem_responsavel" ? "__none" : sp.get("responsavel") ?? "";
  const cls = "h-8 rounded-md border border-border bg-surface px-2 text-[13px] text-fg";
  return (
    <div className="flex flex-wrap gap-2">
      <select aria-label="Cliente" className={cls} value={sp.get("cliente") ?? ""} onChange={(e) => go({ cliente: e.target.value || null })}>
        <option value="">Todos os clientes</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select aria-label="Responsável" className={cls} value={who}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__none") go({ responsavel: null, situacao: "sem_responsavel", status: null });
          else go({ responsavel: v || null, situacao: sp.get("situacao") === "sem_responsavel" ? null : sp.get("situacao") });
        }}>
        <option value="">Toda a equipe</option>
        <option value="__none">Sem responsável</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </div>
  );
}
