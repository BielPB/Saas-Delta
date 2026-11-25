"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MoreHorizontal, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Dialog, Menu, MenuItem, useToast } from "@/components/ui/overlay";
import { inviteMember, setRoles, setStatus } from "./actions";

type Role = { key: string; name: string; description: string };

function RolePicker({ roles, value, onChange, canGrantOwner }: { roles: Role[]; value: Set<string>; onChange: (s: Set<string>) => void; canGrantOwner: boolean }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1 text-[13px] font-medium">Funções</legend>
      {roles.filter((r) => canGrantOwner || r.key !== "owner").map((r) => (
        <label key={r.key} className="flex items-start gap-2 rounded-md px-1 py-1 text-[13px] hover:bg-surface-2">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--fg)]" checked={value.has(r.key)}
            onChange={(e) => { const n = new Set(value); if (e.target.checked) n.add(r.key); else n.delete(r.key); onChange(n); }} />
          <span><span className="font-medium">{r.name}</span> <span className="text-muted">— {r.description}</span></span>
        </label>
      ))}
    </fieldset>
  );
}

export function InviteButton({ roles, canGrantOwner }: { roles: Role[]; canGrantOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sel, setSel] = useState(new Set<string>());
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}><UserPlus /> Convidar</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Convidar colaborador"
        footer={<><Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="primary" disabled={pending || !email || sel.size === 0} onClick={() => start(async () => {
            const r = await inviteMember({ email, roles: [...sel] });
            if (r.ok) { toast.success(r.message ?? "Convidado."); setOpen(false); setEmail(""); setSel(new Set()); router.refresh(); } else toast.error(r.error);
          })}>Enviar convite</Button></>}>
        <div className="space-y-4">
          <label className="block text-[13px] font-medium">E-mail<Input className="mt-1.5" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
          <RolePicker roles={roles} value={sel} onChange={setSel} canGrantOwner={canGrantOwner} />
          <p className="text-xs text-muted">Colaboradores sem “ver todos os clientes” só enxergam os clientes em que forem alocados (aba Configurações de cada cliente).</p>
        </div>
      </Dialog>
    </>
  );
}

export function MemberRowActions({ member, roles, canGrantOwner }: { member: { id: string; name: string; roles: string[]; status: string }; roles: Role[]; canGrantOwner: boolean }) {
  const [edit, setEdit] = useState(false);
  const [sel, setSel] = useState(new Set(member.roles));
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => {
    const r = await fn(); if (r.ok) { toast.success(r.message ?? "Feito."); setEdit(false); router.refresh(); } else toast.error(r.error ?? "Erro.");
  });
  return (
    <>
      <Menu label={`Ações para ${member.name}`} trigger={(p) => <Button size="icon-sm" variant="ghost" {...p}><MoreHorizontal /></Button>}>
        {(close) => (
          <>
            <MenuItem onSelect={() => { close(); setEdit(true); }}>Alterar funções</MenuItem>
            {member.status === "active" && <MenuItem danger onSelect={() => { close(); run(() => setStatus(member.id, false)); }}>Desativar acesso</MenuItem>}
            {member.status === "disabled" && <MenuItem onSelect={() => { close(); run(() => setStatus(member.id, true)); }}>Reativar</MenuItem>}
          </>
        )}
      </Menu>
      <Dialog open={edit} onClose={() => setEdit(false)} title={`Funções de ${member.name}`}
        footer={<><Button onClick={() => setEdit(false)}>Cancelar</Button><Button variant="primary" disabled={pending || sel.size === 0} onClick={() => run(() => setRoles(member.id, [...sel]))}>Salvar</Button></>}>
        <RolePicker roles={roles} value={sel} onChange={setSel} canGrantOwner={canGrantOwner} />
      </Dialog>
    </>
  );
}
