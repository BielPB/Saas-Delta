import Link from "next/link";
import { cn } from "@/lib/utils";

/** URL-driven tabs: each tab is a real link (shareable, works without JS). */
export function LinkTabs({ tabs, active, base, param = "aba" }: {
  tabs: Array<{ key: string; label: string; count?: number }>;
  active: string;
  base: string;
  param?: string;
}) {
  return (
    <nav className="-mx-4 mb-5 flex gap-0.5 overflow-x-auto border-b border-border px-3 sm:-mx-1 sm:px-1" aria-label="Seções">
      {tabs.map((t, i) => {
        const href = i === 0 ? base : `${base}?${param}=${t.key}`;
        const on = active === t.key;
        return (
          <Link key={t.key} href={href} aria-current={on ? "page" : undefined}
            className={cn("relative -mb-px flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-2.5 text-[13px] text-muted hover:text-fg pointer-coarse:h-11",
              on && "border-fg font-medium text-fg")}>
            {t.label}
            {t.count !== undefined && <span className="tabular rounded-sm bg-surface-2 px-1 text-[11px] text-muted">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
