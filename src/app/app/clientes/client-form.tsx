"use client";
import { useActionState, useEffect } from "react";
import { Checkbox, Field, FormError, Input, SubmitButton, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/overlay";
import type { ActionResult } from "@/lib/errors";
import { saveClient } from "./actions";

export interface ClientValues {
  id?: string; name?: string; company_name?: string | null; segment?: string | null; contact_name?: string | null;
  phone?: string | null; email?: string | null; instagram?: string | null; website?: string | null; contract_start?: string | null;
  monthly_target?: number; notes?: string | null; is_sensitive?: boolean; drive_folder_id?: string | null;
}

export function ClientForm({ initial, disabled }: { initial?: ClientValues; disabled?: boolean }) {
  const [state, action] = useActionState<ActionResult | null, FormData>(saveClient, null);
  const toast = useToast();
  useEffect(() => { if (state?.ok && state.message) toast.success(state.message); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const v = initial ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <FormError message={state && !state.ok ? state.error : null} />
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome do cliente" error={fe?.name} required>{(p) => <Input {...p} name="name" defaultValue={v.name} autoFocus={!v.id} />}</Field>
        <Field label="Empresa" error={fe?.company_name}>{(p) => <Input {...p} name="company_name" defaultValue={v.company_name ?? ""} />}</Field>
        <Field label="Segmento" error={fe?.segment}>{(p) => <Input {...p} name="segment" defaultValue={v.segment ?? ""} placeholder="Clínica estética, varejo…" />}</Field>
        <Field label="Responsável no cliente" error={fe?.contact_name}>{(p) => <Input {...p} name="contact_name" defaultValue={v.contact_name ?? ""} />}</Field>
        <Field label="Telefone" error={fe?.phone}>{(p) => <Input {...p} name="phone" type="tel" inputMode="tel" defaultValue={v.phone ?? ""} />}</Field>
        <Field label="E-mail" error={fe?.email}>{(p) => <Input {...p} name="email" type="email" defaultValue={v.email ?? ""} />}</Field>
        <Field label="Instagram" error={fe?.instagram}>{(p) => <Input {...p} name="instagram" defaultValue={v.instagram ?? ""} placeholder="@perfil" />}</Field>
        <Field label="Website" error={fe?.website}>{(p) => <Input {...p} name="website" type="url" defaultValue={v.website ?? ""} placeholder="https://" />}</Field>
        <Field label="Início do contrato" error={fe?.contract_start}>{(p) => <Input {...p} name="contract_start" type="date" defaultValue={v.contract_start ?? ""} />}</Field>
        <Field label="Meta mensal de conteúdos" hint="Metas por mês, serviço e formato ficam na aba Serviços." error={fe?.monthly_target}>
          {(p) => <Input {...p} name="monthly_target" type="number" min={0} inputMode="numeric" defaultValue={v.monthly_target ?? 0} />}
        </Field>
        <Field label="Pasta do Google Drive (ID)" hint="Também pode ser vinculada em Integrações." error={fe?.drive_folder_id} className="sm:col-span-2">
          {(p) => <Input {...p} name="drive_folder_id" defaultValue={v.drive_folder_id ?? ""} />}
        </Field>
        <Field label="Observações internas" hint="Nunca aparecem para o cliente." error={fe?.notes} className="sm:col-span-2">
          {(p) => <Textarea {...p} name="notes" defaultValue={v.notes ?? ""} rows={3} />}
        </Field>
        <div className="sm:col-span-2">
          <Checkbox name="is_sensitive" defaultChecked={v.is_sensitive}
            label={<span><span className="font-medium">Material sensível</span> <span className="text-muted">— ex.: imagens de pacientes. Links de aprovação passam a exigir PIN e validade de até 30 dias.</span></span>} />
        </div>
      </fieldset>
      {!disabled && <SubmitButton pendingLabel="Salvando…">{v.id ? "Salvar alterações" : "Cadastrar cliente"}</SubmitButton>}
    </form>
  );
}
