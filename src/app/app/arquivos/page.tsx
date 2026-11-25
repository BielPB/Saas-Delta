import type { Metadata } from "next";
import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { assetSelect, listClientsLite, signPaths, type AssetRow } from "@/lib/data";
import { bytes, relative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { FileActions, LibraryUpload } from "./file-actions";

export const metadata: Metadata = { title: "Arquivos" };

const categories: Record<string, string> = {
  raw: "Material bruto", edited_video: "Vídeos editados", cover: "Capas", image: "Imagens", carousel: "Carrosséis",
  script: "Roteiros", document: "Documentos", approved: "Materiais aprovados", brand: "Identidades visuais",
};

export default async function FilesPage({ searchParams }: { searchParams: Promise<{ cliente?: string; categoria?: string; aba?: string; status?: string; arquivo?: string }> }) {
  const ctx = await getContext();
  const sp = await searchParams;
  const sb = await createClient();
  const unlinkedTab = sp.aba === "nao-vinculados";
  let q = sb.from("file_assets").select(`${assetSelect}, clients(name), deliverable_version_assets(version_id)`).eq("workspace_id", ctx.workspace.id).is("archived_at", null)
    .order("created_at", { ascending: false }).limit(unlinkedTab ? 300 : 120);
  if (sp.cliente) q = q.eq("client_id", sp.cliente);
  if (sp.categoria && categories[sp.categoria]) q = q.eq("category", sp.categoria);
  if (sp.status === "missing") q = q.eq("status", "missing");
  if (sp.arquivo) q = q.eq("id", sp.arquivo);
  const [{ data }, clients] = await Promise.all([q, listClientsLite(ctx.workspace.id)]);
  let rows = (data ?? []) as unknown as Array<AssetRow & { clients: { name: string } | null; deliverable_version_assets: Array<{ version_id: string }> }>;
  if (unlinkedTab) rows = rows.filter((r) => r.deliverable_version_assets.length === 0 && r.category !== "brand");
  const urls = await signPaths(rows.filter((r) => r.mime_type?.startsWith("image/")).map((r) => r.thumbnail_path ?? r.storage_path));
  const canUpload = ctx.can("files.manage") || ctx.can("files.upload");
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ cliente: sp.cliente, categoria: sp.categoria, aba: sp.aba, ...patch }).filter(([, v]) => v) as Array<[string, string]>);
    return `/app/arquivos${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Arquivos" description="Material bruto fica no Drive (referência); finais e previews ficam no armazenamento privado; textos ficam no banco."
        actions={canUpload && <LibraryUpload workspaceId={ctx.workspace.id} clients={clients} />} />
      <nav className="mb-3 flex flex-wrap gap-1" aria-label="Seções de arquivos">
        <Link href={link({ aba: undefined })} aria-current={!unlinkedTab ? "page" : undefined} className="rounded-md px-2.5 py-1 text-[13px] text-muted aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium aria-[current=page]:text-fg">Biblioteca</Link>
        <Link href={link({ aba: "nao-vinculados" })} aria-current={unlinkedTab ? "page" : undefined} className="rounded-md px-2.5 py-1 text-[13px] text-muted aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium aria-[current=page]:text-fg">Não vinculados</Link>
      </nav>
      <div className="mb-4 flex flex-wrap gap-2">
        <form action="/app/arquivos" className="flex flex-wrap gap-2">
          {sp.aba && <input type="hidden" name="aba" value={sp.aba} />}
          <select name="cliente" defaultValue={sp.cliente ?? ""} aria-label="Cliente" className="h-8 rounded-md border border-border bg-surface px-2 text-[13px]">
            <option value="">Todos os clientes</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select name="categoria" defaultValue={sp.categoria ?? ""} aria-label="Categoria" className="h-8 rounded-md border border-border bg-surface px-2 text-[13px]">
            <option value="">Todas as categorias</option>{Object.entries(categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="h-8 rounded-md border border-border px-2.5 text-[13px] hover:bg-surface-2" type="submit">Filtrar</button>
        </form>
      </div>

      {unlinkedTab && <p className="mb-3 text-[13px] text-muted">Arquivos novos das pastas monitoradas aparecem aqui. As sugestões consideram nome, pasta, serviço e entregáveis em aberto; nada é vinculado sem sua confirmação.</p>}

      {rows.length === 0 ? (
        <Panel><EmptyState icon={<FolderOpen />} title={unlinkedTab ? "Tudo vinculado" : "Nenhum arquivo"} description={unlinkedTab ? "Nenhum arquivo pendente de vínculo." : "Envie arquivos ou conecte o Google Drive em Integrações."} /></Panel>
      ) : (
        <Panel padded={false}>
          <ul className="divide-y divide-border">
            {rows.map((f) => {
              const u = urls.get(f.thumbnail_path ?? f.storage_path ?? "");
              return (
                <li key={f.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-2.5", sp.arquivo === f.id && "bg-accent-soft")}>
                  <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-surface-2 text-[10px] uppercase text-subtle">
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
                    {u ? <img src={u} alt="" className="size-full object-cover" loading="lazy" /> : (f.mime_type?.split("/")[1] ?? "doc").slice(0, 4)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium" title={f.name}>{f.name}</p>
                    <p className="text-xs text-muted">{f.clients?.name ?? "Geral"} · {categories[f.category] ?? f.category} · {f.provider === "drive" ? "Google Drive" : bytes(f.size_bytes)} · {relative(f.created_at)}</p>
                  </div>
                  {f.status === "missing" && <Badge tone="danger">Não encontrado na origem</Badge>}
                  {f.status === "processing" && <Badge tone="info">Gerando preview</Badge>}
                  {f.deliverable_version_assets.length > 0 ? <Badge tone="success">Vinculado</Badge> : <Badge>Sem vínculo</Badge>}
                  {f.drive_file_id && <a className="text-xs text-muted underline-offset-2 hover:underline" target="_blank" rel="noreferrer noopener" href={`https://drive.google.com/file/d/${encodeURIComponent(f.drive_file_id)}/view`}>Abrir no Drive</a>}
                  <FileActions asset={{ id: f.id, name: f.name, provider: f.provider, linked: f.deliverable_version_assets.length > 0, clientId: f.client_id, mime: f.mime_type }}
                    canManage={ctx.can("files.manage")} canCreateContent={ctx.can("contents.manage")} />
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </>
  );
}
