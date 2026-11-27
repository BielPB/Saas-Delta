/**
 * Agency brand color → theme variables.
 * The whole UI reads --accent / --accent-fg / --accent-soft / --accent-ink (globals.css, lime by default).
 * Any color the agency picks must stay readable: text on the accent button is black or white
 * (whichever contrasts more), and the "ink" used for text/links is darkened (light theme) or
 * lightened (dark theme) until it reaches WCAG AA against the page.
 */
const HEX = /^#[0-9A-Fa-f]{6}$/;
export const DEFAULT_BRAND = "#C6FF34";

type RGB = [number, number, number];
const toRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function luminance([r, g, b]: RGB) {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const CARBON: RGB = [23, 23, 23];
const PAGE_DARK: RGB = [20, 20, 20]; // --surface in the dark theme

/** Moves `c` toward `to` in small steps until it reaches `min` contrast against `bg`. */
function until(c: RGB, to: RGB, bg: RGB, min: number): RGB {
  let out = c;
  for (let t = 0; t <= 1 && contrast(out, bg) < min; t += 0.05) out = mix(c, to, t);
  return out;
}

export function brandCss(raw: string | null | undefined): string {
  const hex = raw && HEX.test(raw) ? raw : DEFAULT_BRAND;
  if (hex.toLowerCase() === DEFAULT_BRAND.toLowerCase()) return ""; // default theme already has it
  const c = toRgb(hex);
  const fg = (bg: RGB) => (contrast(bg, WHITE) >= contrast(bg, CARBON) ? "#ffffff" : "#171717");

  // Light theme
  const lightInk = until(c, BLACK, WHITE, 4.5);
  const lightSoft = mix(c, WHITE, 0.88);
  // Dark theme: the button keeps the brand color but never sinks into the background.
  const darkAccent = until(c, WHITE, PAGE_DARK, 3);
  const darkInk = until(c, WHITE, PAGE_DARK, 4.5);
  const darkSoft = mix(c, [11, 11, 11], 0.78);

  const light = `--accent:${hex};--accent-fg:${fg(c)};--accent-soft:${toHex(lightSoft)};--accent-ink:${toHex(lightInk)};--tone-accent-bg:${toHex(lightSoft)};--tone-accent-fg:${toHex(lightInk)};`;
  const dark = `--accent:${toHex(darkAccent)};--accent-fg:${fg(darkAccent)};--accent-soft:${toHex(darkSoft)};--accent-ink:${toHex(darkInk)};--ring:${toHex(darkInk)};--tone-accent-bg:${toHex(darkSoft)};--tone-accent-fg:${toHex(darkInk)};`;
  // :root:root / :root.dark beat the defaults in globals.css whatever the stylesheet order.
  return `:root:root{${light}}:root.dark{${dark}}`;
}
