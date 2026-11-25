"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Field, FormError, Input, SubmitButton } from "@/components/ui/form";
import type { ActionResult } from "@/lib/errors";
import { requestReset, signIn, signUp, updatePassword } from "./actions";

type Action = (s: ActionResult | null, f: FormData) => Promise<ActionResult>;

function useAuthForm(action: Action) {
  return useActionState<ActionResult | null, FormData>(action, null);
}
const err = (s: ActionResult | null, k: string) => (s && !s.ok ? s.fieldErrors?.[k] : undefined);

export function SignInForm({ next }: { next?: string }) {
  const [state, action] = useAuthForm(signIn);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next ?? "/app"} />
      <FormError message={state && !state.ok ? state.error : null} />
      <Field label="E-mail" error={err(state, "email")} required>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" inputMode="email" autoFocus />}
      </Field>
      <Field label="Senha" error={err(state, "password")} required>
        {(p) => <Input {...p} name="password" type="password" autoComplete="current-password" />}
      </Field>
      <div className="flex justify-end">
        <Link href="/recuperar-senha" className="text-xs text-muted underline-offset-4 hover:text-fg hover:underline">Esqueci minha senha</Link>
      </div>
      <SubmitButton className="w-full" pendingLabel="Entrando…">Entrar</SubmitButton>
    </form>
  );
}

export function SignUpForm() {
  const [state, action] = useAuthForm(signUp);
  if (state?.ok) return <p role="status" className="rounded-md border border-border bg-surface-2 p-4 text-sm">{state.message}</p>;
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError message={state && !state.ok ? state.error : null} />
      <Field label="Nome" error={err(state, "name")} required>
        {(p) => <Input {...p} name="name" autoComplete="name" autoFocus />}
      </Field>
      <Field label="E-mail profissional" error={err(state, "email")} required>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" inputMode="email" />}
      </Field>
      <Field label="Senha" hint="Mínimo de 8 caracteres." error={err(state, "password")} required>
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" />}
      </Field>
      <SubmitButton className="w-full" pendingLabel="Criando conta…">Criar conta</SubmitButton>
    </form>
  );
}

export function ResetRequestForm() {
  const [state, action] = useAuthForm(requestReset);
  if (state?.ok) return <p role="status" className="rounded-md border border-border bg-surface-2 p-4 text-sm">{state.message}</p>;
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError message={state && !state.ok ? state.error : null} />
      <Field label="E-mail" error={err(state, "email")} required>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" autoFocus />}
      </Field>
      <SubmitButton className="w-full" pendingLabel="Enviando…">Enviar link de redefinição</SubmitButton>
    </form>
  );
}

export function NewPasswordForm() {
  const [state, action] = useAuthForm(updatePassword);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError message={state && !state.ok ? state.error : null} />
      <Field label="Nova senha" hint="Mínimo de 8 caracteres." error={err(state, "password")} required>
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" autoFocus />}
      </Field>
      <Field label="Confirmar senha" error={err(state, "confirm")} required>
        {(p) => <Input {...p} name="confirm" type="password" autoComplete="new-password" />}
      </Field>
      <SubmitButton className="w-full" pendingLabel="Salvando…">Salvar nova senha</SubmitButton>
    </form>
  );
}
