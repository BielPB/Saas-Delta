"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, KeyRound, Loader2, MessageCircle, MoreHorizontal, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Dialog, Menu, MenuItem, useToast } from "@/components/ui/overlay";
import { generateAccess, inviteMember, setMemberTarget, setRoles, setStatus } from "./actions";

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

export function MemberRowActions({ member, roles, canGrantOwner, workspaceName }: { member: { id: string; name: string; roles: string[]; status: string }; roles: Role[]; canGrantOwner: boolean; workspaceName: string }) {
  const [edit, setEdit] = useState(false);
  const [sel, setSel] = useState(new Set(member.roles));
  const [access, setAccess] = useState<"confirm" | { email: string; password: string } | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => {
    const r = await fn(); if (r.ok) { toast.success(r.message ?? "Feito."); setEdit(false); router.refresh(); } else toast.error(r.error ?? "Erro.");
  });
  const generate = () => start(async () => {
    const r = await generateAccess(member.id);
    if (r.ok && r.data) setAccess(r.data); else { setAccess(null); if (!r.ok) toast.error(r.error); }
  });
  const loginUrl = typeof window === "undefined" ? "" : `${window.location.origin}/entrar`;
  const message = access && access !== "confirm"
    ? `Oi! Seu acesso ao Delta Flow (${workspaceName}) está pronto.\n\nEntre em: ${loginUrl}\nE-mail: ${access.email}\nSenha provisória: ${access.password}\n\nDepois de entrar, troque a senha em Minha conta.`
    : "";
  return (
    <>
      <Menu label={`Ações para ${member.name}`} trigger={(p) => <Button size="icon-sm" variant="ghost" {...p}><MoreHorizontal /></Button>}>
        {(close) => (
          <>
            {member.status === "invited" && <MenuItem onSelect={() => { close(); setAccess("confirm"); }}><KeyRound /> Gerar acesso</MenuItem>}
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

      <Dialog open={access === "confirm"} onClose={() => setAccess(null)} size="sm" title={`Gerar acesso para ${member.name}?`}
        description="Cria o login desta pessoa com uma senha provisória, para você mandar pelo WhatsApp (o envio de convites por e-mail ainda não está configurado)."
        footer={<><Button onClick={() => setAccess(null)}>Cancelar</Button>
          <Button variant="primary" disabled={pending} onClick={generate}>{pending ? <Loader2 className="animate-spin" /> : <KeyRound />} Gerar acesso</Button></>}>
        <p className="text-sm text-muted">Ao entrar pela primeira vez, ela já cai na agência com as funções do convite. Se você gerar de novo, a senha anterior deixa de valer.</p>
      </Dialog>

      <Dialog open={access !== null && access !== "confirm"} onClose={() => setAccess(null)} size="sm" title="Acesso pronto"
        description="Mande agora: por segurança a senha não aparece de novo. Se perder, gere outra.">
        {access && access !== "confirm" && (
          <div className="space-y-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 text-sm">
              <dt className="text-muted">Endereço</dt><dd className="break-all font-mono text-xs leading-5">{loginUrl}</dd>
              <dt className="text-muted">E-mail</dt><dd className="break-all">{access.email}</dd>
              <dt className="text-muted">Senha</dt><dd className="tabular font-mono font-semibold">{access.password}</dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button className="flex-1" onClick={() => navigator.clipboard.writeText(message).then(() => toast.success("Mensagem copiada."))}><Copy /> Copiar</Button>
              <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer noopener"
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-semibold text-accent-fg pointer-coarse:h-10">
                <MessageCircle className="size-4" aria-hidden /> Enviar no WhatsApp
              </a>
            </div>
            <p className="text-xs text-muted">Depois de entrar, a pessoa troca a senha em Minha conta.</p>
          </div>
        )}
      </Dialog>
    </>
  );
}

/** Monthly goal (approved posts) for the team ranking; saves on blur. */
export function MemberTargetInput({ userId, value }: { userId: string; value: number | null }) {
  const [v, setV] = useState(value === null ? "" : String(value));
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const save = () => {
    const next = v.trim() === "" ? null : Number(v);
    if (next === value) return;
    start(async () => {
      const r = await setMemberTarget(userId, next);
      if (r.ok) { toast.success(r.message ?? "Salvo."); router.refresh(); } else { toast.error(r.error); setV(value === null ? "" : String(value)); }
    });
  };
  return (
    <input type="number" min={0} max={1000} inputMode="numeric" value={v} disabled={pending} onChange={(e) => setV(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      placeholder="—" aria-label="Meta mensal de posts aprovados"
      className="tabular h-8 w-16 rounded-md border border-border bg-surface px-2 text-right text-[13px] pointer-coarse:h-10 sm:w-20" />
  );
}
