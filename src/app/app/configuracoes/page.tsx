import type { Metadata } from "next";
import { ProfileForm } from "../conta/forms";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listFormats, listTemplates, signPaths } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { PageHeader, Panel, Table } from "@/components/ui/primitives";
import { LinkTabs } from "@/components/ui/tabs";
import { subdivisionText } from "@/lib/labels";
import { AgencyForm, ApprovalSettingsForm, FormatsManager, RolesManager, TemplatesManager } from "./forms";

export const metadata: Metadata = { title: "Configurações" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const ctx = await getContext();
  const profilePanel = <Panel title="Meu perfil"><ProfileForm name={ctx.profile.full_name} /></Panel>;
  if (!ctx.can("workspace.manage") && !ctx.can("roles.manage") && !ctx.can("members.manage")) {
    return <div className="max-w-3xl"><PageHeader title="Configurações" />{profilePanel}</div>;
  }
  const sp = await searchParams;
  const tab = ["perfil", "agencia", "aprovacao", "funcoes", "templates", "formatos", "seguranca", "armazenamento"].includes(sp.aba ?? "") ? sp.aba! : "agencia";
  const sb = await createClient();
  const ws = ctx.workspace.id;

  const [{ data: w }, { data: s }] = await Promise.all([
    sb.from("workspaces").select("name, slug, brand_color, timezone, logo_path, plan").eq("id", ws).single(),
    sb.from("workspace_settings").select("*").eq("workspace_id", ws).single(),
  ]);
  const logo = w?.logo_path ? (await signPaths([w.logo_path])).get(w.logo_path) ?? null : null;

  return (
    <div className="max-w-5xl">
      <PageHeader title="Configurações" description={`${w?.name} · deltaflow.com.br/${w?.slug} · plano ${w?.plan}`} />
      <LinkTabs active={tab} base="/app/configuracoes" tabs={[
        { key: "agencia", label: "Agência e identidade" }, { key: "perfil", label: "Meu perfil" }, { key: "aprovacao", label: "Aprovações e notificações" },
        { key: "funcoes", label: "Funções e permissões" }, { key: "templates", label: "Templates de produção" }, { key: "formatos", label: "Formatos" },
        { key: "seguranca", label: "Segurança e auditoria" }, { key: "armazenamento", label: "Armazenamento" },
      ]} />
      {tab === "perfil" && profilePanel}
      {tab === "agencia" && <Panel><AgencyForm workspaceId={ws} canEdit={ctx.can("workspace.manage")} initial={{ name: w!.name, brand_color: w!.brand_color, timezone: w!.timezone, logo_path: w!.logo_path, logoUrl: logo }} /></Panel>}
      {tab === "aprovacao" && s && <Panel><ApprovalSettingsForm canEdit={ctx.can("workspace.manage")} initial={s as never} /></Panel>}
      {tab === "funcoes" && <RolesTab ws={ws} canEdit={ctx.can("roles.manage")} mine={ctx.permissions} />}
      {tab === "templates" && <TemplatesTab ws={ws} canEdit={ctx.can("contents.manage")} />}
      {tab === "formatos" && <FormatsTab ws={ws} canEdit={ctx.can("workspace.manage")} />}
      {tab === "seguranca" && <AuditTab ws={ws} can={ctx.can("audit.view")} />}
      {tab === "armazenamento" && (
        <Panel title="Estratégia de armazenamento">
          <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-muted">
            <li>Material bruto permanece no Google Drive da agência; o Delta Flow guarda só a referência (ID oficial do arquivo).</li>
            <li>Vídeos finais, capas e artes enviados pela plataforma ficam no bucket privado <code className="font-mono text-fg">workspace-files</code>, acessíveis apenas por URLs assinadas de curta duração.</li>
            <li>Previews compatíveis com navegador são gerados pelo worker para o portal do cliente.</li>
            <li>Legendas e roteiros são texto no banco, versionados.</li>
            <li>A camada de arquivos é independente do provedor (file_assets.provider), pronta para Cloudflare R2, S3, Mux ou Stream.</li>
          </ul>
          <p className="mt-3 text-xs text-muted">Detalhes, premissas e estimativa de custos em ARCHITECTURE.md › Armazenamento.</p>
        </Panel>
      )}
    </div>
  );
}

async function RolesTab({ ws, canEdit, mine }: { ws: string; canEdit: boolean; mine: string[] }) {
  const sb = await createClient();
  const [{ data: roles }, { data: perms }] = await Promise.all([
    sb.from("roles").select("key, name, description, is_system, produces_kinds, role_permissions(permission_key)").eq("workspace_id", ws).order("is_system", { ascending: false }).order("name"),
    sb.from("permissions").select("key, resource, description").order("resource"),
  ]);
  return <RolesManager canEdit={canEdit} mine={mine}
    roles={(roles ?? []).map((r) => ({ key: r.key as string, name: r.name as string, description: (r.description as string) ?? "", system: r.is_system as boolean,
      produces: r.produces_kinds as string[], permissions: (r.role_permissions as Array<{ permission_key: string }>).map((p) => p.permission_key) }))}
    permissions={((perms ?? []) as Array<{ key: string; resource: string; description: string }>).map((p) => ({ ...p, description: subdivisionText(p.description) }))} />;
}

async function TemplatesTab({ ws, canEdit }: { ws: string; canEdit: boolean }) {
  const [templates, formats] = await Promise.all([listTemplates(ws), listFormats(ws)]);
  const sb = await createClient();
  const { data: roles } = await sb.from("roles").select("key, name").eq("workspace_id", ws);
  return <TemplatesManager canEdit={canEdit} templates={templates} formats={formats.map((f) => ({ id: f.id, name: f.name }))} roles={(roles ?? []) as Array<{ key: string; name: string }>} />;
}

async function FormatsTab({ ws, canEdit }: { ws: string; canEdit: boolean }) {
  const formats = await listFormats(ws);
  return <FormatsManager canEdit={canEdit} formats={formats} />;
}

async function AuditTab({ ws, can }: { ws: string; can: boolean }) {
  if (!can) return <Panel><p className="text-[13px] text-muted">Você não tem permissão para ver a auditoria.</p></Panel>;
  const sb = await createClient();
  const { data } = await sb.from("audit_logs").select("id, action, actor_id, entity_type, data, created_at").eq("workspace_id", ws).order("id", { ascending: false }).limit(200);
  return (
    <Panel title="Log de auditoria (imutável)" padded={false}>
      <Table>
        <thead><tr><th>Quando</th><th>Ação</th><th>Entidade</th><th>Detalhes</th></tr></thead>
        <tbody>
          {(data ?? []).map((e) => (
            <tr key={e.id as number}>
              <td className="whitespace-nowrap text-muted">{formatDateTime(e.created_at as string)}</td>
              <td className="font-mono text-xs">{e.action as string}</td>
              <td className="text-muted">{e.entity_type as string}</td>
              <td className="max-w-md wrap-anywhere whitespace-normal font-mono text-[11px] text-muted" title={JSON.stringify(e.data)}>{JSON.stringify(e.data)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Panel>
  );
}
