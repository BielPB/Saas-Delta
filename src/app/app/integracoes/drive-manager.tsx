"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ChevronRight, Folder, FolderOpen, Loader2, RefreshCw, Trash2, Unplug } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Dialog, useToast } from "@/components/ui/overlay";
import { Badge, EmptyState, Panel } from "@/components/ui/primitives";
import { relative } from "@/lib/format";
import { browseFolder, disconnectDrive, mapFolder, removeMapping, syncMapping } from "./actions";

interface Conn { id: string; google_email: string; status: string; last_error: string | null }
interface Map { id: string; connection_id: string; drive_folder_id: string; folder_name: string; folder_path: string | null; client_id: string; client_name: string; service_name: string | null; category: string | null; last_synced_at: string | null }

export function DriveManager({ canManage, configured, connections, mappings, clients, services }: {
  canManage: boolean; configured: boolean; connections: Conn[]; mappings: Map[];
  clients: Array<{ id: string; name: string }>; services: Array<{ id: string; name: string; client_id: string }>;
}) {
  const [picker, setPicker] = useState<Conn | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  const run = (id: string, fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    setBusy(id);
    start(async () => { const r = await fn(); setBusy(null); if (r.ok) { toast.success(r.message ?? "Feito."); router.refresh(); } else toast.error(r.error ?? "Erro."); });
  };

  return (
    <Panel title="Google Drive" actions={canManage && configured && <ButtonLink href="/api/drive/connect" size="sm" prefetch={false}>{connections.length ? "Conectar outra conta" : "Conectar Google Drive"}</ButtonLink>} padded={false}>
      {!configured && <p className="border-b border-border px-4 py-3 text-[13px] text-muted">Integração indisponível: faltam credenciais do Google no servidor (veja DEPLOYMENT.md). Nada é simulado.</p>}
      {connections.length === 0 ? (
        <EmptyState compact icon={<Folder />} title="Nenhuma conta conectada" description="Conecte a conta Google onde ficam as pastas dos clientes. O acesso é somente leitura." />
      ) : (
        <ul className="divide-y divide-border">
          {connections.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium">{c.google_email}</span>
                {c.status === "active" ? <Badge tone="success">Conectado</Badge> : <Badge tone="danger">Reconectar</Badge>}
                <span className="flex-1" />
                {canManage && <Button size="sm" onClick={() => setPicker(c)}><FolderOpen /> Vincular pasta</Button>}
                {canManage && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(c.id, () => disconnectDrive(c.id))}><Unplug /> Desconectar</Button>}
              </div>
              <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                {mappings.filter((m) => m.connection_id === c.id).length === 0 && <li className="px-3 py-2 text-[13px] text-muted">Nenhuma pasta vinculada.</li>}
                {mappings.filter((m) => m.connection_id === c.id).map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                    <Folder className="size-4 text-muted" />
                    <span className="min-w-0 flex-1 truncate" title={m.folder_path ?? m.folder_name}>{m.folder_path ?? m.folder_name}</span>
                    <span className="text-muted">→ {m.client_name}{m.service_name ? ` · ${m.service_name}` : ""}</span>
                    <span className="text-xs text-subtle">{m.last_synced_at ? `sinc. ${relative(m.last_synced_at)}` : "nunca sincronizada"}</span>
                    <Button size="sm" disabled={pending} onClick={() => run(m.id, () => syncMapping(m.id))}>
                      {busy === m.id ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sincronizar
                    </Button>
                    {canManage && <Button size="icon-sm" variant="ghost" aria-label="Remover vínculo" onClick={() => run(m.id, () => removeMapping(m.id))}><Trash2 /></Button>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {picker && <FolderPicker conn={picker} clients={clients} services={services} onClose={() => setPicker(null)} />}
    </Panel>
  );
}

function FolderPicker({ conn, clients, services, onClose }: {
  conn: Conn; clients: Array<{ id: string; name: string }>; services: Array<{ id: string; name: string; client_id: string }>; onClose: () => void;
}) {
  const [trail, setTrail] = useState<Array<{ id: string; name: string }>>([{ id: "root", name: "Meu Drive" }]);
  const [folders, setFolders] = useState<Array<{ id: string; name: string }> | null>(null);
  const [client, setClient] = useState("");
  const [service, setService] = useState("");
  const [category, setCategory] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const current = trail[trail.length - 1];

  const load = (id: string) => start(async () => {
    setFolders(null);
    const r = await browseFolder(conn.id, id);
    if (r.ok) setFolders(r.data ?? []); else { toast.error(r.error); setFolders([]); }
  });
  useEffect(() => { load("root"); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open onClose={onClose} size="lg" title="Vincular pasta do Drive" description={`Conta ${conn.google_email}. Navegue até a pasta do cliente ou do serviço.`}
      footer={<><Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" disabled={pending || !client || current.id === "root"} onClick={() => start(async () => {
          const r = await mapFolder({ connection_id: conn.id, drive_folder_id: current.id, folder_name: current.name, folder_path: trail.slice(1).map((t) => t.name).join(" / "),
            client_id: client, service_id: service || null, category: (category || null) as never });
          if (r.ok) { toast.success(r.message ?? "Vinculada."); onClose(); router.refresh(); } else toast.error(r.error);
        })}>Vincular “{current.name}”</Button></>}>
      <nav className="mb-2 flex flex-wrap items-center gap-1 text-[13px]" aria-label="Caminho">
        {trail.map((t, i) => (
          <span key={t.id} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3 text-subtle" />}
            <button type="button" className="hover:underline" onClick={() => { const n = trail.slice(0, i + 1); setTrail(n); load(t.id); }}>{t.name}</button>
          </span>
        ))}
      </nav>
      <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
        {folders === null ? <li className="flex justify-center p-4"><Loader2 className="size-4 animate-spin text-muted" /></li> :
          folders.length === 0 ? <li className="px-3 py-3 text-[13px] text-muted">Sem subpastas.</li> :
          folders.map((f) => (
            <li key={f.id}><button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2"
              onClick={() => { setTrail([...trail, f]); load(f.id); }}><Folder className="size-4 text-muted" />{f.name}</button></li>
          ))}
      </ul>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium">Cliente
          <Select className="mt-1" value={client} onChange={(e) => { setClient(e.target.value); setService(""); }}><option value="">Selecione…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        </label>
        <label className="text-xs font-medium">Serviço (subpasta)
          <Select className="mt-1" value={service} onChange={(e) => setService(e.target.value)} disabled={!client}><option value="">Pasta geral do cliente</option>{services.filter((s) => s.client_id === client).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </label>
        <label className="text-xs font-medium">Tipo de material
          <Select className="mt-1" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Detectar pelo nome da pasta</option><option value="raw">Material bruto</option><option value="edited_video">Vídeos editados</option>
            <option value="cover">Capas</option><option value="image">Imagens</option><option value="carousel">Carrosséis</option><option value="brand">Identidade visual</option>
          </Select>
        </label>
      </div>
    </Dialog>
  );
}
