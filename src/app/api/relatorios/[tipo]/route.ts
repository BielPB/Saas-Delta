import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/utils";

export async function GET(request: NextRequest, { params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await params;
  const ctx = await getContext();
  if (!ctx.can("reports.view")) return new NextResponse("Sem permissão", { status: 403 });
  const sp = new URL(request.url).searchParams;
  const de = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("de") ?? "") ? sp.get("de")! : new Date().toISOString().slice(0, 8) + "01";
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("ate") ?? "") ? sp.get("ate")! : new Date().toISOString().slice(0, 10);
  const args = { p_ws: ctx.workspace.id, p_from: `${de}T00:00:00-03:00`, p_to: new Date(new Date(`${ate}T00:00:00-03:00`).getTime() + 864e5).toISOString() };
  const sb = await createClient();

  let csv: string;
  if (tipo === "clientes") {
    const { data } = await sb.rpc("report_clients", args);
    csv = toCsv((data ?? []) as Array<Record<string, unknown>>, [
      { key: "client_name", label: "Cliente" }, { key: "contracted", label: "Contratados" }, { key: "produced", label: "Produzidos" },
      { key: "approved", label: "Aprovados" }, { key: "published", label: "Publicados" }, { key: "target_pct", label: "Cumprimento da meta (%)" },
      { key: "adjustments", label: "Solicitações de ajuste" }, { key: "avg_approval_hours", label: "Tempo médio de aprovação (h)" },
      { key: "by_service", label: "Por serviço" }, { key: "by_format", label: "Por formato" },
    ]);
  } else if (tipo === "colaboradores") {
    const { data } = await sb.rpc("report_members", args);
    csv = toCsv((data ?? []) as Array<Record<string, unknown>>, [
      { key: "full_name", label: "Colaborador" }, { key: "assigned", label: "Atribuídas" }, { key: "done", label: "Concluídas" },
      { key: "overdue", label: "Atrasadas" }, { key: "in_progress", label: "Em andamento" }, { key: "avg_completion_hours", label: "Tempo médio de conclusão (h)" },
      { key: "adjustments", label: "Ajustes" }, { key: "open_load", label: "Carga aberta" },
    ]);
  } else {
    return new NextResponse("Relatório inexistente", { status: 404 });
  }
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="delta-flow-${tipo}-${de}-a-${ate}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
