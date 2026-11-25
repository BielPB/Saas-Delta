"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/overlay";
import { Panel } from "@/components/ui/primitives";
import { relative, toLocalInput } from "@/lib/format";
import { addComment, updateTask } from "../actions";

type Check = { id: string; text: string; done: boolean };

export function TaskEditor({ task, canEditMeta, canEditBody, members, comments }: {
  task: { id: string; description: string; checklist: Check[]; assignee: string | null; due: string | null; priority: string; contentId: string | null };
  canEditMeta: boolean; canEditBody: boolean;
  members: Array<{ id: string; name: string }>;
  comments: Array<{ id: string; body: string; at: string; author: string }>;
}) {
  const [desc, setDesc] = useState(task.description);
  const [list, setList] = useState<Check[]>(task.checklist);
  const [item, setItem] = useState("");
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const save = (patch: Parameters<typeof updateTask>[1], silent = false) => start(async () => {
    const r = await updateTask(task.id, patch);
    if (r.ok) { if (!silent) toast.success(r.message ?? "Salvo."); router.refresh(); } else toast.error(r.error);
  });
  const done = list.filter((c) => c.done).length;

  return (
    <>
      {canEditMeta && (
        <Panel title="Atribuição">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium">Responsável
              <Select className="mt-1" defaultValue={task.assignee ?? ""} onChange={(e) => save({ assignee_id: e.target.value || null })}>
                <option value="">Sem responsável</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </label>
            <label className="text-xs font-medium">Prazo
              <Input className="mt-1" type="datetime-local" defaultValue={toLocalInput(task.due)} onBlur={(e) => e.target.value !== toLocalInput(task.due) && save({ due_at: e.target.value || null })} />
            </label>
            <label className="text-xs font-medium">Prioridade
              <Select className="mt-1" defaultValue={task.priority} onChange={(e) => save({ priority: e.target.value })}>
                <option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="urgent">Urgente</option>
              </Select>
            </label>
          </div>
        </Panel>
      )}
      <Panel title="Descrição">
        {canEditBody ? (
          <>
            <Textarea rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Descrição" />
            {desc !== task.description && <div className="mt-2 flex justify-end"><Button size="sm" variant="primary" disabled={pending} onClick={() => save({ description: desc })}>Salvar descrição</Button></div>}
          </>
        ) : <p className="whitespace-pre-wrap text-[13px]">{task.description || "—"}</p>}
      </Panel>
      <Panel title={`Checklist ${list.length ? `· ${done}/${list.length}` : ""}`}>
        <ul className="space-y-1.5">
          {list.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" className="size-4 accent-[var(--fg)]" checked={c.done} disabled={!canEditBody} aria-label={c.text}
                onChange={(e) => { const n = list.map((x) => (x.id === c.id ? { ...x, done: e.target.checked } : x)); setList(n); save({ checklist: n }, true); }} />
              <span className={c.done ? "text-muted line-through" : ""}>{c.text}</span>
              {canEditBody && <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="Remover item" onClick={() => { const n = list.filter((x) => x.id !== c.id); setList(n); save({ checklist: n }, true); }}><Trash2 /></Button>}
            </li>
          ))}
        </ul>
        {canEditBody && (
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!item.trim()) return; const n = [...list, { id: crypto.randomUUID(), text: item.trim(), done: false }]; setList(n); setItem(""); save({ checklist: n }, true); }}>
            <Input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Novo item" aria-label="Novo item do checklist" className="h-8" />
            <Button size="sm" type="submit"><Plus /> Adicionar</Button>
          </form>
        )}
      </Panel>
      {task.contentId && (
        <Panel title="Comentários">
          <ul className="mb-3 space-y-2">
            {comments.length === 0 && <li className="text-[13px] text-muted">Sem comentários.</li>}
            {comments.map((c) => <li key={c.id} className="text-[13px]"><span className="font-medium">{c.author}</span> <span className="text-xs text-subtle">{relative(c.at)}</span><p className="whitespace-pre-wrap">{c.body}</p></li>)}
          </ul>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await addComment(task.contentId!, comment, task.id); if (r.ok) { setComment(""); router.refresh(); } else toast.error(r.error); }); }}>
            <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comentário" placeholder="Comentário interno…" />
            <div className="flex justify-end"><Button size="sm" type="submit" disabled={pending || !comment.trim()}>Comentar</Button></div>
          </form>
        </Panel>
      )}
    </>
  );
}
