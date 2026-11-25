export const DEFAULT_TZ = "America/Fortaleza";

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions, tz = DEFAULT_TZ) {
  const k = JSON.stringify(opts) + tz;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, ...opts });
    cache.set(k, f);
  }
  return f;
}

export function formatDate(v: string | Date | null | undefined, tz?: string) {
  if (!v) return "—";
  return fmt({ day: "2-digit", month: "short" }, tz).format(new Date(v)).replace(".", "");
}
export function formatDateFull(v: string | Date | null | undefined, tz?: string) {
  if (!v) return "—";
  return fmt({ day: "2-digit", month: "2-digit", year: "numeric" }, tz).format(new Date(v));
}
export function formatDateTime(v: string | Date | null | undefined, tz?: string) {
  if (!v) return "—";
  return fmt({ day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }, tz).format(new Date(v)).replace(".", "");
}
export function formatTime(v: string | Date | null | undefined, tz?: string) {
  if (!v) return "";
  return fmt({ hour: "2-digit", minute: "2-digit" }, tz).format(new Date(v));
}

export function relative(v: string | Date | null | undefined, now = new Date()) {
  if (!v) return "—";
  const diff = new Date(v).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  if (abs < 60_000) return "agora";
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return formatDateFull(v);
}

export function bytes(n: number | null | undefined) {
  if (!n && n !== 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let x = n;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(x < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}

/** Local date/time (in the workspace TZ) → ISO string for <input type="datetime-local">. */
export function toLocalInput(v: string | null | undefined, tz = DEFAULT_TZ) {
  if (!v) return "";
  const parts = fmt({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, tz)
    .formatToParts(new Date(v));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/** "2026-11-24T14:30" interpreted in tz → ISO UTC. */
export function fromLocalInput(v: string | null | undefined, tz = DEFAULT_TZ): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h = "09", mi = "00"] = m;
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  // Offset of tz at that instant, computed from the formatter (DST-safe).
  const asTz = new Date(new Date(guess).toLocaleString("en-US", { timeZone: tz }));
  const asUtc = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess - (asTz.getTime() - asUtc.getTime())).toISOString();
}

export function monthStart(d = new Date(), tz = DEFAULT_TZ) {
  const local = toLocalInput(d.toISOString(), tz);
  return `${local.slice(0, 7)}-01`;
}

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}
