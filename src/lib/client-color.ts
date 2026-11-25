/** Deterministic, calm colour per client (used on server and client). */
const hues = [152, 200, 262, 28, 340, 92, 180, 8];
export function clientHue(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return hues[h % hues.length];
}
