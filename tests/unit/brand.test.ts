import { describe, expect, it } from "vitest";
import { brandCss } from "@/lib/brand";

const lum = (hex: string) => {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: string, b: string) => { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };
const vars = (css: string, scope: string) => {
  const block = css.split(scope)[1]?.split("}")[0] ?? "";
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):(#[0-9a-fA-F]{6})/gi)].map((m) => [m[1], m[2]]));
};

describe("brandCss", () => {
  it("leaves the default lime theme alone", () => {
    expect(brandCss("#C6FF34")).toBe("");
    expect(brandCss("lixo")).toBe("");
    expect(brandCss(null)).toBe("");
  });

  it.each(["#5B010B", "#0B3D91", "#FFFFFF", "#000000", "#FFD400", "#E11D48"])("keeps %s readable in both themes", (hex) => {
    const css = brandCss(hex);
    const light = vars(css, ":root:root{");
    const dark = vars(css, ":root.dark{");
    expect(contrast(light["accent-fg"], light.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light["accent-ink"], "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark["accent-fg"], dark.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark["accent-ink"], "#141414")).toBeGreaterThanOrEqual(4.5);
  });

  it("uses the exact brand color on buttons in the light theme", () => {
    expect(vars(brandCss("#5B010B"), ":root:root{").accent).toBe("#5B010B");
    expect(vars(brandCss("#5B010B"), ":root:root{")["accent-fg"]).toBe("#ffffff");
  });
});
