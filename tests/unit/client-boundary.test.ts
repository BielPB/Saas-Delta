import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A Server Component that imports a plain function/value (not a component) from a
 * "use client" module receives a client reference, which crashes at runtime
 * ("x is not a function"). tsc and next build do not catch it, so this test does.
 */
const root = join(__dirname, "../../src");
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []; });
const files = walk(root);
const isClient = (src: string) => /^\s*["']use client["']/.test(src);
const modId = (p: string) => "@/" + relative(root, p).replace(/\\/g, "/").replace(/\.(ts|tsx)$/, "");

describe("fronteira servidor/cliente", () => {
  it("telas do servidor não importam funções comuns de módulos 'use client'", () => {
    const plain = new Map<string, Set<string>>();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!isClient(src)) continue;
      const names = [...src.matchAll(/^export (?:async )?(?:function|const|let) ([a-z][A-Za-z0-9_]*)/gm)].map((m) => m[1]).filter((n) => !/^use[A-Z]/.test(n));
      if (names.length) plain.set(modId(f), new Set(names));
    }
    const problems: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (isClient(src)) continue;
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
        const target = m[2].startsWith("@/") ? m[2] : null;
        const bad = target ? plain.get(target) : undefined;
        if (!bad) continue;
        for (const raw of m[1].split(",")) {
          const name = raw.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0].trim();
          if (!raw.trim().startsWith("type") && bad.has(name)) problems.push(`${relative(root, f)} importa ${name} de ${target}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
