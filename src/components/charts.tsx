/**
 * Minimal single-series charts (magnitude). One hue, thin bars with 4px
 * rounded data-ends anchored to the baseline, 2px gaps, recessive axis,
 * hover tooltip per mark and a visually hidden table for screen readers.
 */
export function ColumnChart({ data, label, height = 140 }: {
  data: Array<{ label: string; value: number; detail?: string }>;
  label: string;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure>
      <div className="flex items-end gap-[2px]" style={{ height }} aria-hidden>
        {data.map((d) => (
          <div key={d.label} className="group relative flex h-full flex-1 flex-col justify-end">
            <div className="mx-auto w-full max-w-10 rounded-t-[4px] bg-fg/75 transition-colors group-hover:bg-fg"
                 style={{ height: `${Math.max(d.value ? 3 : 0, (d.value / max) * 100)}%` }} />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-sm bg-fg px-2 py-1 text-[11px] text-bg group-hover:block">
              <span className="font-semibold">{d.value}</span> · {d.label}{d.detail ? ` · ${d.detail}` : ""}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px] border-t border-border pt-1.5" aria-hidden>
        {data.map((d) => <span key={d.label} className="flex-1 truncate text-center text-[11px] text-subtle">{d.label}</span>)}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>{data.map((d) => <tr key={d.label}><th>{d.label}</th><td>{d.value}</td><td>{d.detail}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

export function BarList({ data, label, hrefFor }: {
  data: Array<{ key: string; label: string; value: number }>;
  label: string;
  hrefFor?: (key: string) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-1.5" aria-label={label}>
      {data.map((d) => {
        const row = (
          <>
            <span className="w-36 shrink-0 truncate text-[13px] text-muted">{d.label}</span>
            <span className="relative h-5 flex-1">
              <span className="absolute inset-y-0.5 left-0 rounded-r-[4px] bg-fg/70 transition-colors group-hover:bg-fg" style={{ width: `${(d.value / max) * 100}%`, minWidth: d.value ? 3 : 0 }} />
            </span>
            <span className="tabular w-8 text-right text-[13px] font-medium">{d.value}</span>
          </>
        );
        return (
          <li key={d.key}>
            {hrefFor ? (
              <a href={hrefFor(d.key)} className="group flex items-center gap-3 rounded-sm hover:bg-surface-2" title={`${d.label}: ${d.value}`}>{row}</a>
            ) : (
              <div className="group flex items-center gap-3" title={`${d.label}: ${d.value}`}>{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
