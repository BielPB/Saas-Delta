import type { Metadata } from "next";
import Link from "next/link";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listMembers } from "@/lib/data";
import { Avatar, Badge, PageHeader, Panel, Table } from "@/components/ui/primitives";
import { InviteButton, MemberRowActions, MemberTargetInput } from "./member-actions";

export const metadata: Metadata = { title: "Colaboradores" };

export default async function MembersPage() {
  const ctx = await getContext();
  const sb = await createClient();
  const [members, { data: roles }, { data: load }] = await Promise.all([
    listMembers(ctx.workspace.id),
    sb.from("roles").select("key, name, description").eq("workspace_id", ctx.workspace.id).order("is_system", { ascending: false }).order("name"),
    sb.rpc("team_workload", { p_ws: ctx.workspace.id }),
  ]);
  const workload = new Map(((load ?? []) as Array<{ user_id: string; open_tasks: number; overdue: number; overloaded: boolean }>).map((w) => [w.user_id, w]));
  const roleName = new Map((roles ?? []).map((r) => [r.key as string, r.name as string]));
  const canManage = ctx.can("members.manage");
  const roleList = (roles ?? []).map((r) => ({ key: r.key as string, name: r.name as string, description: (r.description as string) ?? "" }));

  return (
    <>
      <PageHeader title="Colaboradores" description={`${members.filter((m) => m.status === "active").length} ativo(s). Uma pessoa pode acumular funções.`}
        actions={canManage && <InviteButton roles={roleList} canGrantOwner={ctx.roles.includes("owner")} />} />
      <Panel padded={false}>
        <Table>
          <thead><tr><th>Pessoa</th><th className="hidden sm:table-cell">Funções</th><th className="hidden md:table-cell">Carga</th><th className="text-right"><span title="Posts aprovados por mês em que a pessoa é responsável ou editora. Usada no ranking do painel.">Meta</span></th><th className="hidden sm:table-cell">Status</th>{canManage && <th className="w-10"><span className="sr-only">Ações</span></th>}</tr></thead>
          <tbody>
            {members.map((m) => {
              const w = workload.get(m.user_id);
              return (
                <tr key={m.member_id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={m.full_name} src={m.avatar_url} size={28} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{m.full_name}{m.user_id === ctx.user.id && <span className="ml-1 text-xs font-normal text-muted">(você)</span>}</p>
                        <p className="truncate text-xs text-muted">{m.email}</p>
                        {/* Phones: roles and status under the name (their columns are hidden). */}
                        <div className="mt-1 flex flex-wrap gap-1 sm:hidden">
                          {m.roles.map((r) => <Badge key={r} tone={r === "owner" ? "accent" : "neutral"}>{roleName.get(r) ?? r}</Badge>)}
                          {m.status === "invited" ? <Badge tone="info">Convidado</Badge> : m.status !== "active" ? <Badge>Desativado</Badge> : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell"><div className="flex flex-wrap gap-1">{m.roles.map((r) => <Badge key={r} tone={r === "owner" ? "accent" : "neutral"}>{roleName.get(r) ?? r}</Badge>)}</div></td>
                  <td className="hidden md:table-cell">
                    {w ? <Link href={`/app/tarefas?responsavel=${m.user_id}`} className="tabular text-[13px] hover:underline">{w.open_tasks} abertas{w.overdue ? ` · ${w.overdue} atrasadas` : ""}</Link> : "—"}
                    {w?.overloaded && <Badge tone="warning" className="ml-1.5">Sobrecarregado</Badge>}
                  </td>
                  <td className="text-right">{canManage && m.status === "active" && m.user_id ? <MemberTargetInput userId={m.user_id} value={m.monthly_target} /> : <span className="tabular text-muted">{m.monthly_target ?? "—"}</span>}</td>
                  <td className="hidden sm:table-cell">{m.status === "active" ? <Badge tone="success">Ativo</Badge> : m.status === "invited" ? <Badge tone="info">Convidado</Badge> : <Badge>Desativado</Badge>}</td>
                  {canManage && <td>{m.user_id !== ctx.user.id && <MemberRowActions member={{ id: m.member_id, name: m.full_name, roles: m.roles, status: m.status }} roles={roleList} canGrantOwner={ctx.roles.includes("owner")} workspaceName={ctx.workspace.name} />}</td>}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Panel>
      <p className="mt-2 text-xs text-muted">
        <strong className="font-medium text-fg">Meta individual:</strong> quantos posts aprovados por mês a pessoa deve entregar, como responsável ou editora. É usada no ranking do painel; quem fica sem meta não entra nele.
      </p>
    </>
  );
}
