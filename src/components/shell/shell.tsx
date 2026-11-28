"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity, ArrowLeft, Bell, Ellipsis, Building2, CalendarDays, ChartColumn, CheckSquare, Film, Folder, Gauge, Kanban, LayoutGrid,
  ListTodo,  Plug, Settings, Stamp, User, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { FloatingDock, type DockItem } from "@/components/ui/floating-dock";
import { Dialog } from "@/components/ui/overlay";
import { Header } from "./header";
import { ClientNav, type NavClient } from "./client-nav";

const icons: Record<string, ReactNode> = {
  layout: <LayoutGrid />, check: <CheckSquare />, list: <ListTodo />, kanban: <Kanban />, calendar: <CalendarDays />,
  building: <Building2 />, film: <Film />, stamp: <Stamp />, folder: <Folder />, users: <Users />, chart: <ChartColumn />,
  gauge: <Gauge />, activity: <Activity />, bell: <Bell />, plug: <Plug />, settings: <Settings />, user: <User />,
};

export interface NavSection { title: string; items: Array<{ href: string; label: string; icon: string }> }

export function Shell({ sections, clientsNav, canManageClients, children, unread, user, workspace, workspaces }: {
  sections: NavSection[];
  clientsNav: NavClient[];
  canManageClients: boolean;
  children: ReactNode;
  unread: number;
  user: { id: string; name: string; email: string; avatar: string | null };
  workspace: { id: string; name: string };
  workspaces: Array<{ id: string; name: string }>;
}) {
  const [panel, setPanel] = useState<"clients" | "more" | null>(null);
  const pathname = usePathname();
  const search = useSearchParams().toString();

  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) { setLastPath(pathname); setPanel(null); }

  // Instant feedback: every page and filter change is a server round trip, so show progress at once.
  const [navigating, setNavigating] = useState(false);
  const [lastUrl, setLastUrl] = useState(`${pathname}?${search}`);
  // How many in-app navigations happened since this tab loaded: "Voltar" only uses history when it stays inside the app.
  const [steps, setSteps] = useState(0);
  if (lastUrl !== `${pathname}?${search}`) { setLastUrl(`${pathname}?${search}`); setNavigating(false); setSteps((n) => n + 1); }
  const router = useRouter();
  const parent = pathname === "/app" ? null : pathname.split("/").slice(0, -1).join("/") || "/app";
  const goBack = () => {
    setNavigating(true);
    if (steps > 0) router.back();
    else router.push(parent ?? "/app");
  };
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname + url.search === location.pathname + location.search) return;
      setNavigating(true);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  useEffect(() => {
    if (!navigating) return;
    const t = setTimeout(() => setNavigating(false), 15000); // safety net
    return () => clearTimeout(t);
  }, [navigating]);
  // PWA: installability + push. The worker caches nothing (see public/sw.js).
  useEffect(() => { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {}); }, []);
  const isActive = (href: string) => pathname === href || (href !== "/app" && pathname.startsWith(href + "/"));
  const primary = sections[0]?.items ?? [];
  const secondary = sections.slice(1).flatMap(section => section.items);
  const dock: DockItem[] = primary.map(item => ({ ...item, icon: icons[item.icon], active: isActive(item.href) }));
  dock.splice(Math.min(3, dock.length), 0, { label: "Clientes", icon: <Building2/>, active: isActive("/app/clientes"), open: () => setPanel("clients") });
  if (secondary.length) dock.push({ label: "Mais opções", icon: <Ellipsis/>, active: secondary.some(item => isActive(item.href)), open: () => setPanel("more") });

  const menuLink = (item: NavSection["items"][number]) => (
    <Link key={item.href} href={item.href} onNavigate={() => setPanel(null)} aria-current={isActive(item.href) ? "page" : undefined}
      className={cn("flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-surface-2", isActive(item.href) && "bg-accent-soft text-accent-ink")}>
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 [&_svg]:size-4">{icons[item.icon]}</span>
      {item.label}
      {item.href === "/app/notificacoes" && unread > 0 && <span className="ml-auto text-xs">{unread}</span>}
    </Link>
  );

  return (
    <div className="flex min-h-dvh">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop">
        Pular para o conteúdo
      </a>

      <FloatingDock items={dock} />
      <Dialog open={panel !== null} onClose={() => setPanel(null)}
        title={panel === "clients" ? "Clientes" : "Mais opções"}>
        {panel === "clients" ? <div onClick={e => {
          if (e.target instanceof Element && e.target.closest("a[href]")) setPanel(null);
        }}><ClientNav clients={clientsNav} canManage={canManageClients}/></div> :
          <div className="grid gap-1 sm:grid-cols-2">
            {secondary.map(menuLink)}
          </div>}
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          brand={<Link href="/app" aria-label="Delta — visão geral" className="mr-1 flex shrink-0 items-center"><Logo compact /></Link>}
          unread={unread} user={user} workspace={workspace} workspaces={workspaces}
        />
        <main key={workspace.id} id="conteudo" aria-busy={navigating} className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-5 lg:px-8">
          {parent && (
            <button type="button" onClick={goBack}
              className="df-press -ml-1 mb-3 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg">
              <ArrowLeft className="size-4" aria-hidden /> Voltar
            </button>
          )}{children}</main>
      </div>
    </div>
  );
}
