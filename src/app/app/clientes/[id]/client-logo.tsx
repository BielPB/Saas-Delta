"use client";
import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { Camera, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/overlay";
import { getBrowserClient } from "@/lib/supabase/browser";
import { ClientAvatar } from "@/components/shell/client-nav";
import { setClientLogo } from "./client-actions";

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Header avatar; managers click it to upload the client's photo or logo. */
export function ClientLogo({ workspaceId, clientId, name, src, canEdit }: { workspaceId: string; clientId: string; name: string; src: string | null; canEdit: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const upload = (file: File) => start(async () => {
    const ext = TYPES[file.type];
    if (!ext) { toast.error("Use uma imagem PNG, JPG ou WEBP."); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("A imagem pode ter no máximo 5 MB."); return; }
    const path = `${workspaceId}/${clientId}/brand/${crypto.randomUUID()}.${ext}`;
    const { error } = await getBrowserClient().storage.from("workspace-files").upload(path, file, { contentType: file.type, upsert: false });
    if (error) { toast.error("Não foi possível enviar a imagem."); return; }
    const r = await setClientLogo(clientId, path);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(r.message ?? "Foto atualizada.");
    router.refresh();
  });
  const avatar = <ClientAvatar name={name} size={48} src={src} />;
  if (!canEdit) return avatar;
  return (
    <>
      <button type="button" onClick={() => input.current?.click()} disabled={pending} title="Trocar foto do cliente" aria-label="Trocar foto do cliente"
        className="group relative shrink-0 rounded-full">
        {avatar}
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
        </span>
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
    </>
  );
}
