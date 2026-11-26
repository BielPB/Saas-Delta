"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Dialog, useToast } from "@/components/ui/overlay";
import { manualStatuses, type WorkStatus } from "@/lib/post-status";
import { createPost } from "@/app/app/clientes/[id]/post-actions";

export interface NewPostOptions {
  clients: Array<{ id: string; name: string }>;
  formats: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string; client_id: string }>;
  defaultClient?: string;
}

/** Quick create in the simple workflow (no task chain), optionally starting in a later stage. */
export function NewPostButton({ options, stage = "script", variant = "primary", iconOnly, label = "Novo conteúdo" }: {
  options: NewPostOptions; stage?: WorkStatus; variant?: "primary" | "ghost"; iconOnly?: boolean; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState(options.defaultClient ?? "");
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState(options.formats[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [service, setService] = useState("");
  const [initial, setInitial] = useState<WorkStatus>(stage);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const services = options.services.filter((s) => s.client_id === client);
  const stageName = manualStatuses.find((s) => s.key === initial)?.label ?? "Roteiro";

  const submit = () => start(async () => {
    const r = await createPost({ clientId: client, formatId: format, title, plannedAt: date || null, serviceId: service || null, stage: initial });
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`Post criado em ${stageName}.`);
    setOpen(false); setTitle(""); setDate(""); setService("");
    router.refresh();
  });

  return (
    <>
      {iconOnly ? (
        <button type="button" onClick={() => { setInitial(stage); setOpen(true); }} aria-label={`Novo post em ${manualStatuses.find((s) => s.key === stage)?.label}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-accent-ink/70 text-accent-ink hover:bg-accent-soft">
          <Plus className="size-4" strokeWidth={2.5} />
        </button>
      ) : (
        <Button variant={variant === "primary" ? "primary" : "ghost"} onClick={() => { setInitial(stage); setOpen(true); }}><Plus /> {label}</Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} size="sm" title="Novo post" description="Só o essencial. Mídia, legenda e responsáveis você completa no post."
        footer={<><Button onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary" disabled={pending || !client || !title.trim() || !format} onClick={submit}>Criar post</Button></>}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {!options.defaultClient && (
            <label className="block text-[13px] font-medium">Cliente
              <Select className="mt-1" value={client} onChange={(e) => { setClient(e.target.value); setService(""); }}>
                <option value="">Selecione…</option>{options.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </label>
          )}
          <label className="block text-[13px] font-medium">Título
            <Input className="mt-1" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Gravação Dr. Carlos — antes e depois" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[13px] font-medium">Formato
              <Select className="mt-1" value={format} onChange={(e) => setFormat(e.target.value)}>
                {options.formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            </label>
            <label className="block text-[13px] font-medium">Começa em
              <Select className="mt-1" value={initial} onChange={(e) => setInitial(e.target.value as WorkStatus)}>
                {manualStatuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </Select>
            </label>
          </div>
          <label className="block text-[13px] font-medium">Publicação <span className="font-normal text-muted">(opcional)</span>
            <Input className="mt-1" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {services.length > 0 && (
            <label className="block text-[13px] font-medium">Subdivisão
              <Select className="mt-1" value={service} onChange={(e) => setService(e.target.value)}>
                <option value="">Nenhuma</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </label>
          )}
        </form>
      </Dialog>
    </>
  );
}
