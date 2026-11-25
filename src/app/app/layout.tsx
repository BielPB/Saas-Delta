import { cookies } from "next/headers";
import { getContext, type Permission } from "@/lib/auth";
import { isConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { projectTree } from "@/lib/data";
import { SetupRequired } from "@/components/setup-required";
import { Shell, type NavSection } from "@/components/shell/shell";

const nav: Array<{ title: string; items: Array<{ href: string; label: string; icon: string; perm?: Permission | Permission[] }> }> = [
  { title: "Workspace", items: [
    { href: "/app", label: "Visão geral", icon: "layout" },
    { href: "/app/minhas-tarefas", label: "Minhas tarefas", icon: "check" },
    { href: "/app/tarefas", label: "Central de tarefas", icon: "list", perm: ["tasks.view_all", "tasks.manage"] },
    { href: "/app/pipeline", label: "Pipeline de produção", icon: "kanban" },
    { href: "/app/calendario", label: "Calendário editorial", icon: "calendar" },
  ] },
  { title: "Gestão", items: [
    { href: "/app/clientes", label: "Clientes", icon: "building" },
    { href: "/app/conteudos", label: "Conteúdos", icon: "film" },
    { href: "/app/aprovacoes", label: "Aprovações", icon: "stamp", perm: "approvals.manage" },
    { href: "/app/arquivos", label: "Arquivos", icon: "folder" },
    { href: "/app/colaboradores", label: "Colaboradores", icon: "users", perm: ["members.manage", "tasks.view_all"] },
  ] },
  { title: "Inteligência operacional", items: [
    { href: "/app/relatorios", label: "Relatórios", icon: "chart", perm: "reports.view" },
    { href: "/app/produtividade", label: "Produtividade", icon: "gauge", perm: ["tasks.view_all", "reports.view"] },
    { href: "/app/atividade", label: "Atividade", icon: "activity" },
  ] },
  { title: "Sistema", items: [
    { href: "/app/notificacoes", label: "Notificações", icon: "bell" },
    { href: "/app/integracoes", label: "Integrações", icon: "plug", perm: ["integrations.manage", "files.manage"] },
    { href: "/app/configuracoes", label: "Configurações", icon: "settings", perm: ["workspace.manage", "members.manage", "roles.manage"] },
    { href: "/app/conta", label: "Minha conta", icon: "user" },
  ] },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isConfigured()) return <SetupRequired />;
  const ctx = await getContext();
  const sb = await createClient();
  // Independent queries: run them together (each round trip to Supabase costs ~140 ms).
  const [{ count }, projects] = await Promise.all([
    sb.from("notifications").select("id", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id).is("read_at", null),
    projectTree(ctx.workspace.id),
  ]);
  const collapsed = (await cookies()).get("df_sidebar")?.value === "collapsed";

  const sections: NavSection[] = nav
    .map((s) => ({
      title: s.title,
      items: s.items
        .filter((i) => !i.perm || (Array.isArray(i.perm) ? i.perm.some((p) => ctx.can(p)) : ctx.can(i.perm)))
        .map(({ href, label, icon }) => ({ href, label, icon })),
    }))
    .filter((s) => s.items.length > 0);

  return (
    <Shell
      sections={sections}
      projects={projects}
      canManageClients={ctx.can("clients.manage")}
      initialCollapsed={collapsed}
      unread={count ?? 0}
      user={{ id: ctx.user.id, name: ctx.profile.full_name || ctx.profile.email || "", email: ctx.profile.email ?? "", avatar: ctx.profile.avatar_url }}
      workspace={{ id: ctx.workspace.id, name: ctx.workspace.name }}
      workspaces={ctx.workspaces.map((w) => ({ id: w.id, name: w.name }))}
    >
      {children}
    </Shell>
  );
}
