import type { Metadata } from "next";
import { Mail, MessageCircle, Share2 } from "lucide-react";
import { getContext } from "@/lib/auth";
import { integrations } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { listClientsLite, listServicesLite } from "@/lib/data";
import { relative } from "@/lib/format";
import { Badge, PageHeader, Panel, Table } from "@/components/ui/primitives";
import { DriveManager } from "./drive-manager";

export const metadata: Metadata = { title: "Integrações" };

const errors: Record<string, string> = {
  permissao: "Você não tem permissão para gerenciar integrações.",
  configuracao: "Google Drive não configurado no servidor (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, DRIVE_TOKEN_ENCRYPTION_KEY, SUPABASE_SERVICE_ROLE_KEY).",
  estado: "A sessão de autorização expirou ou não confere. Tente conectar de novo.",
  negado: "A autorização foi cancelada no Google.",
  offline: "O Google não enviou acesso offline. Remova o Delta Flow em myaccount.google.com/permissions e conecte novamente.",
  escopo: "A permissão de leitura do Drive não foi concedida.",
  google: "Falha ao falar com o Google. Tente novamente.",
  salvar: "Não foi possível salvar a conexão.",
};

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const ctx = await getContext();
  const sp = await searchParams;
  const sb = await createClient();
  const [{ data: conns }, { data: maps }, { data: jobs }, clients, services] = await Promise.all([
    sb.from("drive_connections").select("id, google_email, status, last_error, created_at").eq("workspace_id", ctx.workspace.id).neq("status", "revoked"),
    sb.from("drive_folder_mappings").select("id, connection_id, drive_folder_id, folder_name, folder_path, client_id, service_id, category, last_synced_at, clients(name), client_services(name)").eq("workspace_id", ctx.workspace.id).order("created_at"),
    sb.from("drive_sync_jobs").select("id, status, files_seen, files_new, files_missing, error, started_at, mapping_id").eq("workspace_id", ctx.workspace.id).order("started_at", { ascending: false }).limit(15),
    listClientsLite(ctx.workspace.id), listServicesLite(ctx.workspace.id),
  ]);
  const driveReady = integrations.drive();
  return (
    <>
      <PageHeader title="Integrações" description="O Delta Flow lê o Google Drive da agência sem mover, alterar ou expor os arquivos originais." />
      {sp.erro && <p role="alert" className="mb-4 rounded-md bg-[var(--tone-danger-bg)] px-3 py-2 text-sm text-[var(--tone-danger-fg)]">{errors[sp.erro] ?? "Algo deu errado."}</p>}
      {sp.ok === "drive" && <p role="status" className="mb-4 rounded-md bg-[var(--tone-success-bg)] px-3 py-2 text-sm text-[var(--tone-success-fg)]">Google Drive conectado. Agora vincule as pastas aos clientes.</p>}

      <DriveManager canManage={ctx.can("integrations.manage")} configured={driveReady}
        connections={(conns ?? []) as never}
        mappings={(maps ?? []).map((m) => ({ ...m, client_name: (m.clients as unknown as { name: string })?.name, service_name: (m.client_services as unknown as { name: string } | null)?.name ?? null })) as never}
        clients={clients} services={services} />

      <Panel className="mt-4" title="Últimas sincronizações" padded={false}>
        {(jobs ?? []).length === 0 ? <p className="px-4 py-4 text-[13px] text-muted">Nenhuma sincronização ainda.</p> : (
          <Table>
            <thead><tr><th>Quando</th><th>Pasta</th><th>Resultado</th></tr></thead>
            <tbody>
              {(jobs ?? []).map((j) => (
                <tr key={j.id as string}>
                  <td className="text-muted">{relative(j.started_at as string)}</td>
                  <td>{(maps ?? []).find((m) => m.id === j.mapping_id)?.folder_name ?? "—"}</td>
                  <td>{j.status === "done" ? <span className="text-[13px]">{j.files_seen as number} verificados · {j.files_new as number} novos · {j.files_missing as number} indisponíveis</span>
                    : j.status === "failed" ? <Badge tone="danger">Falhou</Badge> : <Badge tone="info">Em andamento</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Panel title={<span className="flex items-center gap-2"><Mail className="size-4" /> E-mails transacionais</span>}>
          <p className="text-[13px] text-muted">{integrations.email() ? "Resend configurado. Os e-mails seguem as preferências de cada colaborador." : "Defina RESEND_API_KEY e EMAIL_FROM para ativar. As notificações no app funcionam sem isso."}</p>
          <Badge className="mt-2" tone={integrations.email() ? "success" : "neutral"}>{integrations.email() ? "Ativo" : "Não configurado"}</Badge>
        </Panel>
        <Panel title={<span className="flex items-center gap-2"><MessageCircle className="size-4" /> WhatsApp Business</span>}>
          <p className="text-[13px] text-muted">Fase futura (API oficial). Hoje o link de aprovação já abre direto no WhatsApp para envio manual.</p>
          <Badge className="mt-2">Planejado</Badge>
        </Panel>
        <Panel title={<span className="flex items-center gap-2"><Share2 className="size-4" /> Meta (Instagram/Facebook)</span>}>
          <p className="text-[13px] text-muted">Fase futura. O controle de agendamento e publicação é manual e auditado nesta versão.</p>
          <Badge className="mt-2">Planejado</Badge>
        </Panel>
      </div>
    </>
  );
}
