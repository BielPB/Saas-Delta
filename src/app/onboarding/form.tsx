"use client";
import { useActionState, useState } from "react";
import { Field, FormError, Input, SubmitButton } from "@/components/ui/form";
import { slugify } from "@/lib/utils";
import type { ActionResult } from "@/lib/errors";
import { createWorkspace } from "./actions";

export function CreateWorkspaceForm() {
  const [state, action] = useActionState<ActionResult | null, FormData>(createWorkspace, null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError message={state && !state.ok ? state.error : null} />
      <Field label="Nome da agência" error={fe?.name} required>
        {(p) => (
          <Input {...p} name="name" value={name} autoFocus placeholder="Agência Delta"
            onChange={(e) => { setName(e.target.value); if (!touched) setSlug(slugify(e.target.value)); }} />
        )}
      </Field>
      <Field label="Endereço do workspace" hint="Letras minúsculas, números e hífen." error={fe?.slug} required>
        {(p) => (
          <div className="flex items-center rounded-md border border-border bg-surface-2 pl-3 text-sm text-muted focus-within:border-fg">
            <span aria-hidden>deltaflow.com.br/</span>
            <Input {...p} name="slug" value={slug} className="border-0 bg-transparent pl-0.5"
              onChange={(e) => { setTouched(true); setSlug(slugify(e.target.value)); }} />
          </div>
        )}
      </Field>
      <SubmitButton className="w-full" pendingLabel="Criando workspace…">Criar workspace</SubmitButton>
    </form>
  );
}
