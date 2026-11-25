"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormError, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Dialog, useToast } from "@/components/ui/overlay";
import { Badge, EmptyState, Panel } from "@/components/ui/primitives";
import type { ActionResult } from "@/lib/errors";
import { deleteTarget, saveService, saveTarget, setClientMembers, setClientStatus, toggleService } from "../actions";

interface Service { id: string; name: string; description: string | null; color: string; monthly_target: number | null; drive_folder_id: string | null; active: boolean }
const PALETTE = ["#C6FF34", "#3B82F6", "#8B5CF6", "#F59E0B", "#EF4444", "#10B981", "#EC4899", "#737373"];

function useResultToast(state: ActionResult | null, onOk?: () => void) {
  const toast = useToast();
  const router = useRouter();
  useEffect(() => {
    if (!state) return;
    if (state.ok) { if (state.message) toast.success(state.message); onOk?.(); router.refresh(); }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function ServicesManager({ clientId, services, canManage, created }: { clientId: string; services: Service[]; canManage: boolean; created?: boolean }) {
  const [editing, setEditing] = useState<Service | null | "new">(created && services.length === 0 ? "new" : null);
  const [, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <Panel title="Subdivisões" padded={false}
      actions={canManage && <Button size="sm" onClick={() => setEditing("new")}><Plus /> Nova subdivisão</Button>}>
      <div className="border-b border-border bg-surface-2/50 px-4 py-3 text-[13px] text-muted">
        <p>
          <strong className="font-medium text-fg">Subdivisão é uma categoria de conteúdo</strong> deste cliente, como “Fotona Laser” ou “Institucional”.
          Ela organiza o pipeline, os filtros e as metas, e aparece no menu Projetos.
        </p>
        <p className="mt-1.5">
          Ela não é marcada como feita: o andamento do trabalho fica nas <strong className="font-medium text-fg">tarefas</strong> de cada conteúdo
          (a fazer, em andamento, concluída). Acompanhe na aba <Link href={`/app/clientes/${clientId}?aba=tarefas`} className="font-medium text-accent-ink hover:underline">Tarefas</Link>{" "}
          ou na Visão geral, em “Equipe agora”.
        </p>
      </div>
      {services.length === 0 ? (
        <EmptyState compact title="Nenhuma subdivisão cadastrada" description="Ex.: Transplante capilar, Fotona Laser, Institucional." />
      ) : (
        <ul className="divide-y divide-border">
          {services.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="size-3 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{s.name} {!s.active && <Badge className="ml-1">Inativa</Badge>}</p>
                {s.description && <p className="truncate text-xs text-muted">{s.description}</p>}
              </div>
              <span className="text-xs text-muted" title="Posts aprovados por mês vindos desta subdivisão">{s.monthly_target ? `meta: ${s.monthly_target} aprovado(s)/mês` : "sem meta própria"}</span>
              {canManage && (
                <>
                  <Button size="icon-sm" variant="ghost" aria-label={`Editar ${s.name}`} onClick={() => setEditing(s)}><Pencil /></Button>
                  <Button size="sm" variant="ghost" onClick={() => start(async () => {
                    const r = await toggleService(s.id, clientId, !s.active);
                    if (r.ok) { toast.success(r.message ?? "Feito."); router.refresh(); } else toast.error(r.error);
                  })}>{s.active ? "Desativar" : "Ativar"}</Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <ServiceDialog clientId={clientId} service={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function ServiceDialog({ clientId, service, onClose }: { clientId: string; service: Service | null; onClose: () => void }) {
  const [state, action] = useActionState<ActionResult | null, FormData>(saveService, null);
  const [color, setColor] = useState(service?.color ?? PALETTE[1]);
  useResultToast(state, onClose);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <Dialog open onClose={onClose} title={service ? "Editar subdivisão" : "Nova subdivisão"}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="client_id" value={clientId} />
        {service && <input type="hidden" name="id" value={service.id} />}
        <input type="hidden" name="color" value={color} />
        <FormError message={state && !state.ok ? state.error : null} />
        <Field label="Nome" error={fe?.name} required>{(p) => <Input {...p} name="name" defaultValue={service?.name} autoFocus />}</Field>
        <Field label="Descrição" error={fe?.description}>{(p) => <Textarea {...p} name="description" rows={2} defaultValue={service?.description ?? ""} />}</Field>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">Cor de identificação</legend>
          <div className="flex gap-2">
            {PALETTE.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Cor ${c}`} aria-pressed={color === c}
                className="size-7 rounded-full border-2 border-transparent aria-pressed:border-fg" style={{ background: c }} />
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Meta da subdivisão" hint="Opcional. Posts aprovados por mês que devem vir desta subdivisão." error={fe?.monthly_target}>{(p) => <Input {...p} name="monthly_target" type="number" min={0} defaultValue={service?.monthly_target ?? ""} />}</Field>
          <Field label="Pasta do Drive (ID)" error={fe?.drive_folder_id}>{(p) => <Input {...p} name="drive_folder_id" defaultValue={service?.drive_folder_id ?? ""} />}</Field>
        </div>
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancelar</Button><SubmitButton>Salvar subdivisão</SubmitButton></div>
      </form>
    </Dialog>
  );
}

export function TargetsManager({ clientId, targets, services, formats, canManage }: {
  clientId: string;
  targets: Array<{ id: string; month: string; target: number; service_id: string | null; format_id: string | null }>;
  services: Array<{ id: string; name: string }>;
  formats: Array<{ id: string; name: string }>;
  canManage: boolean;
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(saveTarget, null);
  useResultToast(state);
  const [, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const sName = new Map(services.map((s) => [s.id, s.name]));
  const fName = new Map(formats.map((f) => [f.id, f.name]));
  const thisMonth = new Date().toISOString().slice(0, 7);
  return (
    <Panel title="Meta de um mês específico" padded={false}>
      <p className="border-b border-border bg-surface-2/50 px-4 py-3 text-[13px] text-muted">
        Use só quando um mês for diferente do normal (ex.: dezembro com campanha). Vale apenas para o mês escolhido e
        substitui a <strong className="font-medium text-fg">meta do cliente</strong> (posts aprovados por mês, definida em Configurações).
      </p>
      {canManage && (
        <form action={action} className="grid grid-cols-2 gap-3 border-b border-border p-4">
          <input type="hidden" name="client_id" value={clientId} />
          <label className="col-span-1 text-xs text-muted">Mês<Input name="month" type="month" defaultValue={thisMonth} required className="mt-1" /></label>
          <label className="col-span-1 text-xs text-muted">Posts aprovados<Input name="target" type="number" min={0} required className="mt-1" placeholder="Ex.: 12" /></label>
          <label className="col-span-1 text-xs text-muted">Subdivisão
            <Select name="service_id" className="mt-1"><option value="">Todas (meta do cliente)</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          </label>
          <label className="col-span-1 text-xs text-muted">Formato
            <Select name="format_id" className="mt-1"><option value="">Todos</option>{formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>
          </label>
          <div className="col-span-2 flex items-center justify-between gap-2">
            <FormError message={state && !state.ok ? state.error : null} />
            <SubmitButton size="sm" className="ml-auto">Salvar meta do mês</SubmitButton>
          </div>
        </form>
      )}
      {targets.length === 0 ? <EmptyState compact title="Nenhum mês diferente" description="Todos os meses usam a meta do cliente." /> : (
        <ul className="divide-y divide-border">
          {targets.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-4 py-2 text-[13px]">
              <span className="tabular w-16 text-muted">{t.month.slice(0, 7)}</span>
              <span className="min-w-0 flex-1 truncate">{t.service_id ? sName.get(t.service_id) : "Todas as subdivisões"}{t.format_id ? ` · ${fName.get(t.format_id)}` : ""}</span>
              <span className="tabular font-medium">{t.target} <span className="font-normal text-muted">aprovados</span></span>
              {canManage && <Button size="icon-sm" variant="ghost" aria-label="Remover meta" onClick={() => start(async () => {
                const r = await deleteTarget(t.id, clientId); if (r.ok) { toast.success(r.message ?? "Feito."); router.refresh(); } else toast.error(r.error);
              })}><Trash2 /></Button>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function ClientTeam({ clientId, members, selected, canManage }: {
  clientId: string; members: Array<{ id: string; name: string; roles: string[] }>; selected: string[]; canManage: boolean;
}) {
  const [sel, setSel] = useState(new Set(selected));
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const dirty = sel.size !== selected.length || selected.some((s) => !sel.has(s));
  return (
    <div className="space-y-2">
      {members.map((m) => (
        <Checkbox key={m.id} disabled={!canManage} checked={sel.has(m.id)} className="flex"
          onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(m.id); else n.delete(m.id); setSel(n); }}
          label={<span>{m.name} <span className="text-xs text-muted">{m.roles.join(", ")}</span></span>} />
      ))}
      {canManage && dirty && (
        <Button size="sm" variant="primary" disabled={pending} onClick={() => start(async () => {
          const r = await setClientMembers(clientId, [...sel]);
          if (r.ok) { toast.success(r.message ?? "Feito."); router.refresh(); } else toast.error(r.error);
        })}>Salvar equipe</Button>
      )}
    </div>
  );
}

export function ClientStatusActions({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const go = (s: "active" | "inactive" | "archived") => start(async () => {
    const r = await setClientStatus(id, s);
    if (r.ok) { toast.success(r.message ?? "Feito."); router.refresh(); } else toast.error(r.error);
  });
  return (
    <div className="flex flex-wrap gap-2">
      {status !== "active" && <Button size="sm" disabled={pending} onClick={() => go("active")}>Ativar</Button>}
      {status === "active" && <Button size="sm" disabled={pending} onClick={() => go("inactive")}>Desativar</Button>}
      {status !== "archived" && <Button size="sm" variant="danger" disabled={pending} onClick={() => setConfirm(true)}>Arquivar</Button>}
      <Dialog open={confirm} onClose={() => setConfirm(false)} size="sm" title="Arquivar cliente?"
        description="O cliente sai das listas e indicadores ativos. Conteúdos e histórico são preservados e ele pode ser reativado."
        footer={<><Button onClick={() => setConfirm(false)}>Cancelar</Button><Button variant="danger" onClick={() => { setConfirm(false); go("archived"); }}>Arquivar</Button></>} />
    </div>
  );
}
