"use client";
import Link from "next/link";
import { createContext, useContext, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Tabs / segmented buttons that navigate (the server renders the new view).
 * The clicked one lights up immediately, instead of after the server answers;
 * the content follows with the top progress bar. When the new page arrives,
 * `active` from the server takes over again.
 */
const Ctx = createContext<{ shown: string; pick: (v: string) => void }>({ shown: "", pick: () => {} });

export function ToggleGroup({ active, children, as = "nav", className, ...aria }: {
  active: string; children: ReactNode; as?: "nav" | "div"; className?: string;
  "aria-label"?: string; role?: string;
}) {
  const [clicked, setClicked] = useState<string | null>(null);
  const [server, setServer] = useState(active);
  if (server !== active) { setServer(active); setClicked(null); } // new page arrived (or back/forward)
  const Tag = as;
  return (
    <Ctx value={{ shown: clicked ?? active, pick: setClicked }}>
      <Tag className={className} {...aria}>{children}</Tag>
    </Ctx>
  );
}

export function ToggleLink({ value, className, activeClassName, onClick, currentAttr = "page", ...props }: ComponentProps<typeof Link> & {
  value: string; activeClassName?: string;
  /** aria-current value, or aria-selected when the group is a tablist. */
  currentAttr?: "page" | "true" | "tab";
}) {
  const { shown, pick } = useContext(Ctx);
  const on = shown === value;
  const a11y = currentAttr === "tab" ? { role: "tab", "aria-selected": on } : { "aria-current": on ? currentAttr : undefined };
  return (
    <Link {...props} {...a11y} className={cn("df-press", className, on && activeClassName)}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        // Ctrl/Cmd-click opens a new tab: the current view does not change.
        if (!e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) pick(value);
      }} />
  );
}
