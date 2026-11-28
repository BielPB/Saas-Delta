import type { Metadata } from "next";
import Link from "next/link";
import { getContext } from "@/lib/auth";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Avatar, Badge, PageHeader, Panel, Table } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Produtividade" };

interface Row { user_id: string; full_name: string; email: string; open_tasks: number; in_progress: number; overdue: number; due_this_week: number; done_30d: number; overloaded: boolean }

export default async function ProductivityPage() {
  const ctx = await getContext();
  if (!ctx.can("tasks.view_all") && !ctx.can("reports.view")) notFound();
  const sb = await createClient();
  const { data } = await sb.rpc("team_workload", { p_ws: ctx.workspace.id });
  const rows = (data ?? []) as Row[];
  const max = Math.max(1, ...rows.map((r) => Number(r.open_tasks)));
  return (
    <>
      <PageHeader title="Produtividade" description="Carga operacional da equipe. Sobrecarga = 3+ tarefas atrasadas ou 5+ abertas acima de 1,5× a média da equipe." />
      <Panel padded={false}>
        <Table>
          <thead><tr><th>Colaborador</th><th>Carga aberta</th><th className="text-right">Em andamento</th><th className="text-right">Atrasadas</th><th className="text-right">Vencem em 7 dias</th><th className="text-right">Concluídas (30 dias)</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id}>
                <td><div className="flex items-center gap-2"><Avatar name={r.full_name || "Colaborador"} size={24} />
                  <Link className="font-medium hover:underline" href={`/app/tarefas?responsavel=${r.user_id}`}>{r.full_name || "Colaborador"}</Link>
                  {r.overloaded && <Badge tone="warning">Sobrecarregado</Badge>}</div></td>
                <td className="min-w-40">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-surface-3"><div className="h-full rounded-full bg-fg/70" style={{ width: `${(Number(r.open_tasks) / max) * 100}%` }} /></div>
                    <span className="tabular w-6 text-right text-xs">{r.open_tasks}</span>
                  </div>
                </td>
                <td className="tabular text-right">{r.in_progress}</td>
                <td className="tabular text-right">{Number(r.overdue) > 0 ? <span className="text-[var(--tone-danger-fg)]">{r.overdue}</span> : 0}</td>
                <td className="tabular text-right">{r.due_this_week}</td>
                <td className="tabular text-right">{r.done_30d}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}
