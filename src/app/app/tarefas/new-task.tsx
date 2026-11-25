"use client";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Dialog, useToast } from "@/components/ui/overlay";
import type { ActionResult } from "@/lib/errors";
import { createTask } from "./actions";

/**
 * New task. With `post` it is created for that post (e.g. "Edição — Fotona"): client and post are fixed.
 * Without it the person picks the client and, optionally, one of its open posts.
 */
export function NewTaskButton({ clients, members, posts = [], post, label = "Nova tarefa", size, variant = "primary" }: {
  clients: Array<{ id: string; name: string }>; members: Array<{ id: string; name: string }>;
  posts?: Array<{ id: string; client_id: string; label: string }>;
  post?: { id: string; clientId: string; title: string };
  label?: string; size?: "sm" | "md"; variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState(post?.clientId ?? "");
  const toast = useToast();
  const router = useRouter();
  const [state, action] = useActionState<ActionResult | null, FormData>(async (prev, fd) => {
    const r = await createTask(prev, fd);
    if (r.ok) { toast.success(r.message ?? "Tarefa criada."); setOpen(false); router.refresh(); }
    return r;
  }, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const clientPosts = posts.filter((p) => p.client_id === client);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}><Plus /> {label}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={post ? `Nova tarefa · ${post.title}` : "Nova tarefa"}
        description={post ? "A tarefa fica ligada a este post e aparece em Minhas demandas de quem receber." : "Escolha o cliente e, se for o caso, o post. Quem receber vê em Minhas demandas."}>
        <form action={action} className="space-y-4">
          <FormError message={state && !state.ok ? state.error : null} />
          <Field label="Título" error={fe?.title} required>
            {(p) => <Input {...p} name="title" autoFocus defaultValue={post ? `Edição — ${post.title}` : ""} placeholder="Ex.: Edição, Gravação, Captação, Reunião…" />}
          </Field>
          {post ? (
            <>
              <input type="hidden" name="client_id" value={post.clientId} />
              <input type="hidden" name="content_id" value={post.id} />
            </>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cliente" error={fe?.client_id} required>
                {(p) => (
                  <Select {...p} name="client_id" value={client} onChange={(e) => setClient(e.target.value)}>
                    <option value="">Selecione…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Post (opcional)">
                {(p) => (
                  <Select {...p} name="content_id" key={client} defaultValue="" disabled={!client}>
                    <option value="">{client ? (clientPosts.length ? "Tarefa avulsa (sem post)" : "Nenhum post aberto") : "Escolha o cliente"}</option>
                    {clientPosts.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </Select>
                )}
              </Field>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Responsável">{(p) => <Select {...p} name="assignee_id"><option value="">Sem responsável</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
            <Field label="Prazo">{(p) => <Input {...p} name="due_at" type="datetime-local" />}</Field>
            <Field label="Prioridade">{(p) => <Select {...p} name="priority" defaultValue="medium"><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="urgent">Urgente</option></Select>}</Field>
          </div>
          <Field label="Descrição">{(p) => <Textarea {...p} name="description" rows={3} placeholder="O que precisa ser feito, referências, links…" />}</Field>
          <div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)}>Cancelar</Button><SubmitButton>Criar tarefa</SubmitButton></div>
        </form>
      </Dialog>
    </>
  );
}
