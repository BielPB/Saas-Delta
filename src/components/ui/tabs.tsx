import { ToggleGroup, ToggleLink } from "./toggle-links";

/** URL-driven tabs: each tab is a real link (shareable, works without JS); the clicked one lights up at once. */
export function LinkTabs({ tabs, active, base, param = "aba" }: {
  tabs: Array<{ key: string; label: string; count?: number }>;
  active: string;
  base: string;
  param?: string;
}) {
  return (
    <ToggleGroup active={active} aria-label="Seções" className="-mx-4 mb-5 flex gap-0.5 overflow-x-auto border-b border-border px-3 sm:-mx-1 sm:px-1">
      {tabs.map((t, i) => (
        <ToggleLink key={t.key} value={t.key} href={i === 0 ? base : `${base}?${param}=${t.key}`} scroll={false}
          className="relative -mb-px flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-2.5 text-[13px] text-muted hover:text-fg pointer-coarse:h-11"
          activeClassName="border-fg font-medium text-fg">
          {t.label}
          {t.count !== undefined && <span className="tabular rounded-sm bg-surface-2 px-1 text-[11px] text-muted">{t.count}</span>}
        </ToggleLink>
      ))}
    </ToggleGroup>
  );
}
