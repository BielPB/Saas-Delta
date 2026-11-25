"use client";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Dialog, useToast } from "@/components/ui/overlay";
import type { ActionResult } from "@/lib/errors";
import { createTask } from "./actions";

export function NewTaskButton({ clients, members, contentId, clientId }: {
  clients: Array<{ id: string; name: string }>; members: Array<{ id: string; name: string }>; contentId?: string; clientId?: string;
}) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const [state, action] = useActionState<ActionResult | null, FormData>(async (prev, fd) => {
    const r = await createTask(prev, fd);
    if (r.ok) { toast.success(r.message ?? "Tarefa criada."); setOpen(false); router.refresh(); }
    return r;
  }, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}><Plus /> Nova tarefa</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Nova tarefa" description="Tarefas avulsas. As de produção nascem dos templates de conteúdo.">
        <form action={action} className="space-y-4">
          {contentId && <input type="hidden" name="content_id" value={contentId} />}
          <FormError message={state && !state.ok ? state.error : null} />
          <Field label="Título" error={fe?.title} required>{(p) => <Input {...p} name="title" autoFocus />}</Field>
          <Field label="Cliente" error={fe?.client_id} required>
            {(p) => <Select {...p} name="client_id" defaultValue={clientId ?? ""}><option value="">Selecione…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Responsável">{(p) => <Select {...p} name="assignee_id"><option value="">Sem responsável</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
            <Field label="Prazo">{(p) => <Input {...p} name="due_at" type="datetime-local" />}</Field>
            <Field label="Prioridade">{(p) => <Select {...p} name="priority" defaultValue="medium"><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="urgent">Urgente</option></Select>}</Field>
          </div>
          <Field label="Descrição">{(p) => <Textarea {...p} name="description" rows={3} />}</Field>
          <div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)}>Cancelar</Button><SubmitButton>Criar tarefa</SubmitButton></div>
        </form>
      </Dialog>
    </>
  );
}
