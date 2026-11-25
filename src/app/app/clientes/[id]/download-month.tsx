"use client";
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/overlay";
import { makeZip } from "@/lib/zip";
import { monthDownloads } from "./client-actions";

/** Downloads the month's original files (full quality) as one ZIP, built in the browser. */
export function DownloadMonth({ clientId, ym, fileName }: { clientId: string; ym: string; fileName: string }) {
  const [progress, setProgress] = useState<string | null>(null);
  const toast = useToast();
  const run = async () => {
    setProgress("Preparando…");
    try {
      const r = await monthDownloads(clientId, ym);
      if (!r.ok) { toast.error(r.error); return; }
      const enc = new TextEncoder();
      const out: Array<{ name: string; data: Uint8Array }> = r.data!.texts.map((t) => ({ name: t.path, data: enc.encode(t.content) }));
      let i = 0;
      for (const f of r.data!.files) {
        setProgress(`Baixando ${++i} de ${r.data!.files.length}…`);
        const res = await fetch(f.url);
        if (!res.ok) throw new Error("download");
        out.push({ name: f.path, data: new Uint8Array(await res.arrayBuffer()) });
      }
      setProgress("Compactando…");
      const url = URL.createObjectURL(makeZip(out));
      const a = document.createElement("a");
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success(`${r.data!.files.length} arquivo(s) baixados.`);
    } catch {
      toast.error("Não foi possível baixar todos os arquivos. Tente de novo.");
    } finally {
      setProgress(null);
    }
  };
  return (
    <Button size="sm" onClick={run} disabled={progress !== null} title="Arquivos originais do mês, em alta qualidade">
      {progress ? <Loader2 className="animate-spin" /> : <Download />} {progress ?? "Baixar em alta qualidade"}
    </Button>
  );
}
