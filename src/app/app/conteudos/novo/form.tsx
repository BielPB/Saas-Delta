"use client";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/overlay";
import { Field, FormError, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { channels, deliverableKind, type DeliverableKind, type TaskKind } from "@/lib/domain";
import type { ActionResult } from "@/lib/errors";
import { createContentAction } from "../actions";

interface Template { id: string; name: string; description: string | null; format_id: string;
  steps: Array<{ key: string; title: string; role_key: string; deliverable_kind: DeliverableKind | null; depends_on: string[]; offset_days: number; kind: TaskKind }> }

export function NewContentForm({ clients, services, formats, templates, members, defaultClient }: {
  clients: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string; client_id: string }>;
  formats: Array<{ id: string; name: string; required_kinds: DeliverableKind[] }>;
  templates: Template[];
  members: Array<{ id: string; name: string; roles: string[] }>;
  defaultClient?: string;
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(createContentAction, null);
  const [client, setClient] = useState(defaultClient ?? "");
  const [format, setFormat] = useState(formats[0]?.id ?? "");
  const forFormat = templates.filter((t) => t.format_id === format);
  const [template, setTemplate] = useState(""); // default: simple workflow (no task chain)
  const formRef = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const fe = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) { toast.success(state.message ?? "Conteúdo criado."); formRef.current?.querySelector<HTMLInputElement>("[name=title]")?.select(); }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const tpl = templates.find((t) => t.id === template);
  const fmt = formats.find((f) => f.id === format);
  const byRole = useMemo(() => (role: string) => {
    const match = members.filter((m) => m.roles.includes(role));
    return match.length ? [...match, ...members.filter((m) => !m.roles.includes(role))] : members;
  }, [members]);

  return (
    <form ref={formRef} action={action} className="space-y-6" noValidate>
      <FormError message={state && !state.ok ? state.error : null} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Título" error={fe?.title} required className="sm:col-span-2">
          {(p) => <Input {...p} name="title" autoFocus placeholder="Reels Fotona #03 — antes e depois" />}
        </Field>
        <Field label="Cliente" error={fe?.client_id} required>
          {(p) => (
            <Select {...p} name="client_id" value={client} onChange={(e) => setClient(e.target.value)}>
              <option value="">Selecione…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Subdivisão" hint={client && !services.some((s) => s.client_id === client) ? "Este cliente ainda não tem subdivisões." : undefined}>
          {(p) => (
            <Select {...p} name="service_id" disabled={!client}>
              <option value="">Sem subdivisão</option>
              {services.filter((s) => s.client_id === client).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Formato" error={fe?.format_id} required>
          {(p) => <Select {...p} name="format_id" value={format} onChange={(e) => { setFormat(e.target.value); setTemplate(""); }}>{formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>}
        </Field>
        <Field label="Template de produção" hint={tpl?.description ?? (template ? undefined : `Sem template: cria só os entregáveis (${fmt?.required_kinds.map((k) => deliverableKind[k]).join(", ")}).`)}>
          {(p) => (
            <Select {...p} name="template_id" value={template} onChange={(e) => setTemplate(e.target.value)}>
              <option value="">Sem template</option>{forFormat.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Prazo de produção">{(p) => <Input {...p} name="due_at" type="datetime-local" />}</Field>
        <Field label="Data prevista de postagem" hint="Intenção editorial. Não significa agendado.">{(p) => <Input {...p} name="planned_publish_at" type="datetime-local" />}</Field>
        <Field label="Canal">{(p) => <Select {...p} name="channel"><option value="">—</option>{Object.entries(channels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Prioridade">
          {(p) => <Select {...p} name="priority" defaultValue="medium"><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="urgent">Urgente</option></Select>}
        </Field>
        <Field label="Objetivo estratégico" className="sm:col-span-2">{(p) => <Input {...p} name="objective" placeholder="Gerar agendamentos de avaliação" />}</Field>
        <Field label="Briefing" className="sm:col-span-2">{(p) => <Textarea {...p} name="briefing" rows={3} />}</Field>
      </div>

      {tpl && (
        <fieldset className="rounded-md border border-border">
          <legend className="ml-3 px-1 text-[13px] font-medium">Etapas e responsáveis</legend>
          <ol className="divide-y divide-border">
            {tpl.steps.map((s, i) => (
              <li key={s.key} className="grid items-center gap-2 px-3 py-2 sm:grid-cols-[1fr_220px]">
                <div className="text-[13px]">
                  <span className="tabular mr-2 text-subtle">{i + 1}.</span>
                  <span className="font-medium">{s.title}</span>
                  {s.deliverable_kind && <span className="text-muted"> · entrega: {deliverableKind[s.deliverable_kind]}</span>}
                  {s.depends_on.length > 0 && <span className="block pl-5 text-xs text-muted">depois de {s.depends_on.map((d) => tpl.steps.find((x) => x.key === d)?.title).join(", ")}</span>}
                </div>
                <Select name={`assignee:${s.key}`} aria-label={`Responsável por ${s.title}`} defaultValue={byRole(s.role_key).find((m) => m.roles.includes(s.role_key))?.id ?? ""}>
                  <option value="">Sem responsável</option>
                  {byRole(s.role_key).map((m) => <option key={m.id} value={m.id}>{m.name}{m.roles.includes(s.role_key) ? "" : " (outra função)"}</option>)}
                </Select>
              </li>
            ))}
          </ol>
        </fieldset>
      )}

      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingLabel="Criando…">Criar conteúdo</SubmitButton>
        <Button type="submit" name="_another" value="1">Criar e adicionar outro</Button>
      </div>
    </form>
  );
}
