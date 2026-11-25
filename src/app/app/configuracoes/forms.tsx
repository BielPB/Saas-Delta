"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, useToast } from "@/components/ui/overlay";
import { Badge, Panel } from "@/components/ui/primitives";
import { Uploader } from "@/components/files/uploader";
import { deliverableKind, type DeliverableKind, type TaskKind } from "@/lib/domain";
import { assetPath, signedUrl } from "@/app/app/conteudos/actions";
import { deleteRole, saveAgency, saveFormat, saveRole, saveSettings, saveTemplate, toggleTemplate } from "./actions";

function useRun() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return { pending, run: (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) => start(async () => {
    const r = await fn(); if (r.ok) { toast.success(r.message ?? "Salvo."); after?.(); router.refresh(); } else toast.error(r.error ?? "Erro.");
  }) };
}

const TIMEZONES = ["America/Fortaleza", "America/Sao_Paulo", "America/Recife", "America/Bahia", "America/Belem", "America/Manaus", "America/Cuiaba", "America/Porto_Velho", "America/Rio_Branco", "America/Noronha"];

export function AgencyForm({ workspaceId, initial, canEdit }: { workspaceId: string; canEdit: boolean;
  initial: { name: string; brand_color: string; timezone: string; logo_path: string | null; logoUrl: string | null } }) {
  const [v, setV] = useState(initial);
  const [logo, setLogo] = useState(initial.logoUrl);
  const { pending, run } = useRun();
  return (
    <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
      <label className="text-[13px] font-medium">Nome da agência<Input className="mt-1.5" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
      <label className="text-[13px] font-medium">Fuso horário
        <Select className="mt-1.5" value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select>
      </label>
      <label className="text-[13px] font-medium">Cor de destaque (portal do cliente)
        <span className="mt-1.5 flex items-center gap-2"><input type="color" value={v.brand_color} onChange={(e) => setV({ ...v, brand_color: e.target.value.toUpperCase() })} className="h-9 w-12 rounded-md border border-border" aria-label="Cor" />
          <Input value={v.brand_color} onChange={(e) => setV({ ...v, brand_color: e.target.value })} className="font-mono" /></span>
      </label>
      <div className="text-[13px] font-medium">Logotipo
        <div className="mt-1.5 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
          {logo ? <img src={logo} alt="Logotipo atual" className="h-10 w-auto rounded-sm border border-border bg-white p-1" /> : <span className="text-xs text-muted">Sem logotipo</span>}
        </div>
        {canEdit && <div className="mt-2"><Uploader compact workspaceId={workspaceId} clientId={null} category="brand" accept="image" onUploaded={async (ids) => {
          const path = await assetPath(ids[0]);
          if (path) { setV((x) => ({ ...x, logo_path: path })); setLogo(await signedUrl(path)); }
        }} /></div>}
      </div>
      {canEdit && <div className="sm:col-span-2"><Button variant="primary" disabled={pending} onClick={() => run(() => saveAgency(v))}>Salvar</Button></div>}
    </fieldset>
  );
}

export function ApprovalSettingsForm({ initial, canEdit }: { canEdit: boolean; initial: { approval_default_expiry_days: number; approval_require_pin: boolean; approval_stale_after_days: number; notify_email_enabled: boolean; data_retention_months: number } }) {
  const [v, setV] = useState(initial);
  const { pending, run } = useRun();
  return (
    <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
      <label className="text-[13px] font-medium">Validade padrão do link (dias)<Input className="mt-1.5" type="number" min={1} max={90} value={v.approval_default_expiry_days} onChange={(e) => setV({ ...v, approval_default_expiry_days: Number(e.target.value) })} /></label>
      <label className="text-[13px] font-medium">Alertar aprovação parada após (dias)<Input className="mt-1.5" type="number" min={1} max={60} value={v.approval_stale_after_days} onChange={(e) => setV({ ...v, approval_stale_after_days: Number(e.target.value) })} /></label>
      <label className="text-[13px] font-medium">Retenção de dados (meses)<Input className="mt-1.5" type="number" min={1} max={120} value={v.data_retention_months} onChange={(e) => setV({ ...v, data_retention_months: Number(e.target.value) })} />
        <span className="mt-1 block text-xs font-normal text-muted">Referência para a política de retenção (LGPD). A limpeza é executada pelo worker.</span></label>
      <div className="space-y-2 pt-6">
        <Checkbox checked={v.approval_require_pin} onChange={(e) => setV({ ...v, approval_require_pin: e.target.checked })} label="Exigir PIN em todos os links de aprovação" />
        <Checkbox checked={v.notify_email_enabled} onChange={(e) => setV({ ...v, notify_email_enabled: e.target.checked })} label="Permitir notificações por e-mail" />
      </div>
      {canEdit && <div className="sm:col-span-2"><Button variant="primary" disabled={pending} onClick={() => run(() => saveSettings(v))}>Salvar</Button></div>}
    </fieldset>
  );
}

interface Role { key: string; name: string; description: string; system: boolean; produces: string[]; permissions: string[] }
export function RolesManager({ roles, permissions, canEdit, mine }: { roles: Role[]; permissions: Array<{ key: string; resource: string; description: string }>; canEdit: boolean; mine: string[] }) {
  const [edit, setEdit] = useState<Role | null>(null);
  const { pending, run } = useRun();
  const mineSet = new Set(mine);
  return (
    <Panel title="Funções" padded={false} actions={canEdit && <Button size="sm" onClick={() => setEdit({ key: "", name: "", description: "", system: false, produces: [], permissions: [] })}><Plus /> Nova função</Button>}>
      <ul className="divide-y divide-border">
        {roles.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{r.name} {r.system && <Badge className="ml-1">Padrão</Badge>}</p>
              <p className="text-xs text-muted">{r.key === "owner" ? "Todas as permissões" : `${r.permissions.length} permissão(ões)`}{r.produces.length ? ` · produz ${r.produces.map((k) => deliverableKind[k as DeliverableKind]).join(", ")}` : ""}</p>
            </div>
            {canEdit && r.key !== "owner" && <Button size="sm" onClick={() => setEdit(r)}>Editar</Button>}
            {canEdit && !r.system && <Button size="icon-sm" variant="ghost" aria-label={`Excluir ${r.name}`} onClick={() => run(() => deleteRole(r.key))}><Trash2 /></Button>}
          </li>
        ))}
      </ul>
      {edit && (
        <Dialog open onClose={() => setEdit(null)} size="lg" title={edit.key ? `Editar ${edit.name}` : "Nova função"}
          footer={<><Button onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" disabled={pending || !edit.name || !/^[a-z0-9_]{2,40}$/.test(edit.key)}
            onClick={() => run(() => saveRole({ key: edit.key, name: edit.name, description: edit.description, permissions: edit.permissions, produces: edit.produces }), () => setEdit(null))}>Salvar função</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium">Nome<Input className="mt-1" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value, key: edit.system || roles.some((r) => r.key === edit.key && r.name !== "") ? edit.key : e.target.value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40) })} /></label>
            <label className="text-xs font-medium">Chave<Input className="mt-1 font-mono" value={edit.key} disabled={edit.system} onChange={(e) => setEdit({ ...edit, key: e.target.value })} /></label>
            <label className="text-xs font-medium sm:col-span-2">Descrição<Input className="mt-1" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
          </div>
          <fieldset className="mt-4"><legend className="mb-1.5 text-xs font-medium">Permissões</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {permissions.map((p) => (
                <label key={p.key} className={`flex items-start gap-2 rounded-sm px-1 py-1 text-[13px] ${mineSet.has(p.key) ? "" : "opacity-50"}`} title={mineSet.has(p.key) ? undefined : "Você não pode conceder uma permissão que não tem."}>
                  <input type="checkbox" className="mt-0.5 size-4 accent-[var(--fg)]" disabled={!mineSet.has(p.key)} checked={edit.permissions.includes(p.key)}
                    onChange={(e) => setEdit({ ...edit, permissions: e.target.checked ? [...edit.permissions, p.key] : edit.permissions.filter((x) => x !== p.key) })} />
                  <span>{p.description} <span className="font-mono text-[11px] text-subtle">{p.key}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="mt-4"><legend className="mb-1.5 text-xs font-medium">Entregáveis que esta função produz (direciona ajustes)</legend>
            <div className="flex flex-wrap gap-3">
              {(["script", "raw_footage", "video", "cover", "caption", "image", "carousel"] as DeliverableKind[]).map((k) => (
                <Checkbox key={k} label={deliverableKind[k]} checked={edit.produces.includes(k)} onChange={(e) => setEdit({ ...edit, produces: e.target.checked ? [...edit.produces, k] : edit.produces.filter((x) => x !== k) })} />
              ))}
            </div>
          </fieldset>
        </Dialog>
      )}
    </Panel>
  );
}

interface Step { key: string; title: string; role_key: string; deliverable_kind: DeliverableKind | null; depends_on: string[]; offset_days: number; kind: TaskKind }
interface Tpl { id: string; name: string; description: string | null; format_id: string; active: boolean; steps: Step[] }

export function TemplatesManager({ templates, formats, roles, canEdit }: { templates: Tpl[]; formats: Array<{ id: string; name: string }>; roles: Array<{ key: string; name: string }>; canEdit: boolean }) {
  const [edit, setEdit] = useState<Tpl | null>(null);
  const { pending, run } = useRun();
  const fname = new Map(formats.map((f) => [f.id, f.name]));
  const blank: Tpl = { id: "", name: "", description: "", format_id: formats[0]?.id ?? "", active: true, steps: [{ key: "review", title: "Revisão interna", role_key: "manager", deliverable_kind: null, depends_on: [], offset_days: 3, kind: "review" }] };
  return (
    <Panel title="Templates" padded={false} actions={canEdit && <Button size="sm" onClick={() => setEdit(blank)}><Plus /> Novo template</Button>}>
      <ul className="divide-y divide-border">
        {templates.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{t.name} {!t.active && <Badge className="ml-1">Inativo</Badge>}</p>
              <p className="truncate text-xs text-muted">{fname.get(t.format_id)} · {t.steps.map((s) => s.title).join(" → ")}</p>
            </div>
            {canEdit && <>
              <Button size="sm" onClick={() => setEdit(t)}>Editar</Button>
              <Button size="sm" onClick={() => setEdit({ ...t, id: "", name: `${t.name} (cópia)` })}>Duplicar</Button>
              <Button size="sm" variant="ghost" onClick={() => run(() => toggleTemplate(t.id, !t.active))}>{t.active ? "Desativar" : "Ativar"}</Button>
            </>}
          </li>
        ))}
      </ul>
      {edit && (
        <Dialog open onClose={() => setEdit(null)} size="lg" title={edit.id ? "Editar template" : "Novo template"}
          description="Etapas sem dependência começam liberadas; as demais ficam bloqueadas até as anteriores serem concluídas."
          footer={<><Button onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" disabled={pending}
            onClick={() => run(() => saveTemplate({ id: edit.id || undefined, name: edit.name, description: edit.description ?? "", format_id: edit.format_id, steps: edit.steps.map((s) => ({ ...s, kind: s.kind === "adjustment" ? "production" : s.kind })) as never }), () => setEdit(null))}>Salvar</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium">Nome<Input className="mt-1" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="text-xs font-medium">Formato<Select className="mt-1" value={edit.format_id} onChange={(e) => setEdit({ ...edit, format_id: e.target.value })}>{formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></label>
            <label className="text-xs font-medium sm:col-span-2">Descrição<Textarea className="mt-1" rows={2} value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
          </div>
          <ol className="mt-4 space-y-2">
            {edit.steps.map((s, i) => {
              const set = (p: Partial<Step>) => setEdit({ ...edit, steps: edit.steps.map((x, j) => (j === i ? { ...x, ...p } : x)) });
              return (
                <li key={i} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-6">
                  <Input aria-label="Título" className="sm:col-span-2" value={s.title} onChange={(e) => set({ title: e.target.value })} />
                  <Input aria-label="Chave" className="font-mono" value={s.key} onChange={(e) => set({ key: e.target.value.replace(/[^a-z0-9_]/g, "") })} />
                  <Select aria-label="Função" value={s.role_key} onChange={(e) => set({ role_key: e.target.value })}>{roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</Select>
                  <Select aria-label="Entrega" value={s.deliverable_kind ?? ""} onChange={(e) => set({ deliverable_kind: (e.target.value || null) as DeliverableKind | null, kind: e.target.value ? "production" : s.kind })}>
                    <option value="">Sem entrega</option>{Object.entries(deliverableKind).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                  <Input aria-label="Prazo relativo (dias)" type="number" min={0} value={s.offset_days} onChange={(e) => set({ offset_days: Number(e.target.value) })} />
                  <div className="flex flex-wrap items-center gap-2 text-xs sm:col-span-5">
                    <Select aria-label="Tipo" className="h-7 w-auto text-xs" value={s.kind} onChange={(e) => set({ kind: e.target.value as TaskKind })}><option value="production">Produção</option><option value="review">Revisão interna</option><option value="general">Geral</option></Select>
                    <span className="text-muted">depende de:</span>
                    {edit.steps.filter((x) => x.key !== s.key).map((x) => (
                      <label key={x.key} className="inline-flex items-center gap-1"><input type="checkbox" className="size-3.5 accent-[var(--fg)]" checked={s.depends_on.includes(x.key)}
                        onChange={(e) => set({ depends_on: e.target.checked ? [...s.depends_on, x.key] : s.depends_on.filter((d) => d !== x.key) })} />{x.title}</label>
                    ))}
                  </div>
                  <Button size="icon-sm" variant="ghost" aria-label="Remover etapa" onClick={() => setEdit({ ...edit, steps: edit.steps.filter((_, j) => j !== i).map((x) => ({ ...x, depends_on: x.depends_on.filter((d) => d !== s.key) })) })}><Trash2 /></Button>
                </li>
              );
            })}
          </ol>
          <Button size="sm" className="mt-2" onClick={() => setEdit({ ...edit, steps: [...edit.steps, { key: `etapa_${edit.steps.length + 1}`, title: "Nova etapa", role_key: roles[0]?.key ?? "manager", deliverable_kind: null, depends_on: [], offset_days: 1, kind: "production" }] })}><Plus /> Etapa</Button>
        </Dialog>
      )}
    </Panel>
  );
}

export function FormatsManager({ formats, canEdit }: { formats: Array<{ id: string; key: string; name: string; required_kinds: DeliverableKind[]; aspect_ratio: string | null; active: boolean }>; canEdit: boolean }) {
  const [edit, setEdit] = useState<{ key: string; name: string; required_kinds: string[]; aspect_ratio: string | null } | null>(null);
  const { pending, run } = useRun();
  return (
    <Panel title="Formatos de conteúdo" padded={false} actions={canEdit && <Button size="sm" onClick={() => setEdit({ key: "", name: "", required_kinds: ["video", "caption"], aspect_ratio: "9:16" })}><Plus /> Novo formato</Button>}>
      <ul className="divide-y divide-border">
        {formats.map((f) => (
          <li key={f.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
            <span className="min-w-0 flex-1"><span className="font-medium">{f.name}</span> <span className="text-xs text-muted">{f.aspect_ratio} · obrigatórios: {f.required_kinds.map((k) => deliverableKind[k]).join(", ") || "nenhum"}</span></span>
            {canEdit && <Button size="sm" onClick={() => setEdit({ key: f.key, name: f.name, required_kinds: f.required_kinds, aspect_ratio: f.aspect_ratio })}>Editar</Button>}
          </li>
        ))}
      </ul>
      {edit && (
        <Dialog open onClose={() => setEdit(null)} title="Formato" footer={<><Button onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" disabled={pending} onClick={() => run(() => saveFormat(edit), () => setEdit(null))}>Salvar</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium">Nome<Input className="mt-1" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="text-xs font-medium">Chave<Input className="mt-1 font-mono" value={edit.key} onChange={(e) => setEdit({ ...edit, key: e.target.value.replace(/[^a-z0-9_]/g, "") })} /></label>
            <label className="text-xs font-medium">Proporção<Select className="mt-1" value={edit.aspect_ratio ?? ""} onChange={(e) => setEdit({ ...edit, aspect_ratio: e.target.value || null })}>
              <option value="9:16">9:16 (vertical)</option><option value="4:5">4:5 (feed)</option><option value="1:1">1:1</option><option value="16:9">16:9 (horizontal)</option></Select></label>
          </div>
          <fieldset className="mt-3"><legend className="mb-1 text-xs font-medium">Entregáveis obrigatórios para aprovação</legend>
            <div className="flex flex-wrap gap-3">{(["video", "cover", "caption", "image", "carousel"] as DeliverableKind[]).map((k) => (
              <Checkbox key={k} label={deliverableKind[k]} checked={edit.required_kinds.includes(k)} onChange={(e) => setEdit({ ...edit, required_kinds: e.target.checked ? [...edit.required_kinds, k] : edit.required_kinds.filter((x) => x !== k) })} />
            ))}</div>
          </fieldset>
        </Dialog>
      )}
    </Panel>
  );
}
