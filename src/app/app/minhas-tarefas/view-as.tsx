"use client";
import { useRouter, useSearchParams } from "next/navigation";

/** Managers can see someone else's queue ("Ver como"). */
export function ViewAs({ value, me, members }: { value: string; me: string; members: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const sp = useSearchParams();
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      Ver como
      <select value={value} aria-label="Ver demandas de"
        onChange={(e) => {
          const p = new URLSearchParams(sp.toString());
          p.delete("cliente");
          if (e.target.value === me) p.delete("pessoa"); else p.set("pessoa", e.target.value);
          router.push(`/app/minhas-tarefas${p.size ? `?${p}` : ""}`);
        }}
        className="h-8 rounded-md border border-border bg-surface px-2 text-[13px] text-fg">
        {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === me ? " (eu)" : ""}</option>)}
      </select>
    </label>
  );
}
