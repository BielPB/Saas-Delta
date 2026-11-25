"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity, Bell, Building2, CalendarDays, ChartColumn, CheckSquare, Film, Folder, Gauge, Kanban, LayoutGrid,
  ListTodo, Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, Plug, Settings, Stamp, User, Users, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/overlay";
import { Header } from "./header";
import { ProjectTree, type ProjectNode } from "./project-tree";

const icons: Record<string, ReactNode> = {
  layout: <LayoutGrid />, check: <CheckSquare />, list: <ListTodo />, kanban: <Kanban />, calendar: <CalendarDays />,
  building: <Building2 />, film: <Film />, stamp: <Stamp />, folder: <Folder />, users: <Users />, chart: <ChartColumn />,
  gauge: <Gauge />, activity: <Activity />, bell: <Bell />, plug: <Plug />, settings: <Settings />, user: <User />,
};

export interface NavSection { title: string; items: Array<{ href: string; label: string; icon: string }> }

export function Shell({ sections, projects, canManageClients, children, initialCollapsed, unread, user, workspace, workspaces }: {
  sections: NavSection[];
  projects: ProjectNode[];
  canManageClients: boolean;
  children: ReactNode;
  initialCollapsed: boolean;
  unread: number;
  user: { id: string; name: string; email: string; avatar: string | null };
  workspace: { id: string; name: string };
  workspaces: Array<{ id: string; name: string }>;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams().toString();

  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) { setLastPath(pathname); setMobileOpen(false); }

  // Instant feedback: every page and filter change is a server round trip, so show progress at once.
  const [navigating, setNavigating] = useState(false);
  const [lastUrl, setLastUrl] = useState(`${pathname}?${search}`);
  if (lastUrl !== `${pathname}?${search}`) { setLastUrl(`${pathname}?${search}`); setNavigating(false); }
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
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `df_sidebar=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  };

  const isActive = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));

  const navList = (compact: boolean) => (
    <nav aria-label="Navegação principal" className="flex-1 space-y-5 overflow-y-auto px-2 py-3">
      {!compact && <ProjectTree projects={projects} canManage={canManageClients} />}
      {sections.map((s) => (
        <div key={s.title}>
          {!compact && <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-subtle">{s.title}</p>}
          {compact && <div className="mx-2 mb-1 h-px bg-border" aria-hidden />}
          <ul className="space-y-px">
            {s.items.map((i) => {
              const active = isActive(i.href);
              const link = (
                <Link href={i.href} aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-fg [&_svg]:size-4 [&_svg]:shrink-0",
                    active && "bg-surface-2 font-medium text-fg",
                    compact && "w-8 justify-center px-0",
                  )}>
                  {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" aria-hidden />}
                  {icons[i.icon]}
                  {compact ? <span className="sr-only">{i.label}</span> : <span className="truncate">{i.label}</span>}
                  {i.href === "/app/notificacoes" && unread > 0 && !compact && (
                    <span className="tabular ml-auto rounded-sm bg-accent px-1 text-[10.5px] font-semibold text-accent-fg">{unread > 99 ? "99+" : unread}</span>
                  )}
                </Link>
              );
              return <li key={i.href}>{compact ? <Tooltip content={i.label} side="right">{link}</Tooltip> : link}</li>;
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop">
        Pular para o conteúdo
      </a>

      {/* Desktop sidebar */}
      <aside className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-150 md:flex",
        collapsed ? "w-[52px]" : "w-60")}>
        <div className={cn("flex h-12 items-center border-b border-border", collapsed ? "justify-center" : "justify-between px-3")}>
          <Link href="/app" aria-label="Delta Flow — visão geral"><Logo compact={collapsed} /></Link>
          {!collapsed && (
            <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Recolher menu"><PanelLeftClose /></Button>
          )}
        </div>
        {navList(collapsed)}
        {collapsed && (
          <div className="border-t border-border p-2">
            <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Expandir menu"><PanelLeftOpen /></Button>
          </div>
        )}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-[var(--overlay)]" aria-label="Fechar menu" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface">
            <div className="flex h-12 items-center justify-between border-b border-border px-3">
              <Logo />
              <Button variant="ghost" size="icon-sm" onClick={() => setMobileOpen(false)} aria-label="Fechar menu"><X /></Button>
            </div>
            {navList(false)}
          </aside>
        </div>
      )}

      {navigating && <div className="df-progress fixed inset-x-0 top-0 z-[300] h-[3px] bg-accent" role="progressbar" aria-label="Carregando página" />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onOpenMenu={() => setMobileOpen(true)}
          menuButton={<Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menu"><MenuIcon /></Button>}
          unread={unread} user={user} workspace={workspace} workspaces={workspaces}
        />
        <main id="conteudo" aria-busy={navigating} className={cn("mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 transition-opacity duration-200 sm:px-6 lg:px-8", navigating && "opacity-60")}>{children}</main>
      </div>
    </div>
  );
}
