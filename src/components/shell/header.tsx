"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { Bell, Check, ChevronsUpDown, LogOut, Moon, Search, Sun, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, Kbd } from "@/components/ui/primitives";
import { Menu, MenuItem } from "@/components/ui/overlay";
import { getBrowserClient } from "@/lib/supabase/browser";
import { switchWorkspace } from "@/app/app/actions";
import { signOut } from "@/app/(auth)/actions";
import { CommandPalette } from "./command-palette";

/** The theme lives on <html class="dark">; observe it as an external store. */
function subscribeTheme(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}

export function Header({ brand, unread: initialUnread, user, workspace, workspaces }: {
  brand: ReactNode;
  unread: number;
  user: { id: string; name: string; email: string; avatar: string | null };
  workspace: { id: string; name: string };
  workspaces: Array<{ id: string; name: string }>;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [base, setBase] = useState(initialUnread);
  const [extra, setExtra] = useState(0);
  if (base !== initialUnread) { setBase(initialUnread); setExtra(0); }
  const unread = base + extra;
  const dark = useSyncExternalStore(subscribeTheme, () => document.documentElement.classList.contains("dark"), () => false);
  const [, start] = useTransition();
  const router = useRouter();


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Realtime: new notifications for this user bump the counter and refresh server data.
  useEffect(() => {
    const sb = getBrowserClient();
    const ch = sb.channel(`notifications:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => { setExtra((n) => n + 1); router.refresh(); })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [user.id, router]);

  const toggleTheme = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("df-theme", next ? "dark" : "light"); } catch {}
  };

  return (
    // Installed app on iPhone: the bar sits below the clock/notch (safe-area padding on top).
    <header className="sticky top-0 z-40 flex min-h-[calc(3rem+env(safe-area-inset-top))] items-center gap-1.5 border-b border-border bg-surface/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:gap-2 sm:px-4">
      {brand}
      {workspaces.length > 1 ? (
        <Menu label="Trocar workspace" align="start" trigger={(p) => (
          <Button variant="ghost" size="sm" {...p} className="min-w-0 max-w-[9.5rem] font-medium text-fg sm:max-w-48">
            <span className="wrap-anywhere whitespace-normal">{workspace.name}</span><ChevronsUpDown className="text-subtle" />
          </Button>
        )}>
          {(close) => workspaces.map((w) => (
            <MenuItem key={w.id} onSelect={() => { close(); start(() => switchWorkspace(w.id)); }}>
              {w.id === workspace.id ? <Check /> : <span className="size-4" />} {w.name}
            </MenuItem>
          ))}
        </Menu>
      ) : (
        <span className="min-w-0 max-w-[9.5rem] wrap-anywhere whitespace-normal px-1 text-[13px] font-medium sm:max-w-48">{workspace.name}</span>
      )}

      <div className="flex-1" />

      <button type="button" onClick={() => setSearchOpen(true)}
        className="flex h-8 w-9 shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-surface-2 px-2 text-[13px] text-subtle transition-colors hover:border-border-strong hover:text-muted pointer-coarse:size-9 sm:w-64 sm:justify-start"
        aria-label="Buscar (Ctrl K)">
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="hidden flex-1 text-left sm:inline">Buscar clientes, conteúdos, tarefas…</span>
        <span className="hidden sm:inline-flex"><Kbd>⌘K</Kbd></span>
      </button>

      <Link href="/app/notificacoes" aria-label={`Notificações${unread ? `, ${unread} não lidas` : ""}`}
        className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg pointer-coarse:size-9">
        <Bell className="size-4" />
        {unread > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent ring-2 ring-surface" aria-hidden />}
      </Link>

      <Button variant="ghost" size="icon-sm" onClick={toggleTheme} aria-label={dark ? "Usar tema claro" : "Usar tema escuro"}>
        {dark ? <Sun /> : <Moon />}
      </Button>

      <Menu label="Menu da conta" trigger={(p) => (
        <button type="button" {...p} className="flex shrink-0 items-center justify-center rounded-full focus-visible:outline-2 pointer-coarse:size-9"><Avatar name={user.name} src={user.avatar} size={28} /></button>
      )}>
        {(close) => (
          <>
            <div className="border-b border-border px-2.5 pb-2 pt-1.5">
              <p className="wrap-anywhere whitespace-normal text-sm font-medium">{user.name}</p>
              <p className="wrap-anywhere whitespace-normal text-xs text-muted">{user.email}</p>
            </div>
            <div className="pt-1">
              <MenuItem onSelect={() => { close(); router.push("/app/conta"); }}><User /> Minha conta</MenuItem>
              <MenuItem onSelect={() => { close(); start(() => signOut()); }}><LogOut /> Sair</MenuItem>
            </div>
          </>
        )}
      </Menu>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
