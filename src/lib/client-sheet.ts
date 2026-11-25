/** Default onboarding checklist for a new client (editable per client). */
export const defaultOnboarding: Array<{ id: string; label: string }> = [
  { id: "briefing", label: "Briefing inicial" },
  { id: "acessos", label: "Acessos das redes coletados" },
  { id: "paleta", label: "Paleta e identidade visual definidas" },
  { id: "tom", label: "Tom de voz documentado" },
  { id: "reuniao", label: "Reunião de alinhamento" },
  { id: "bio", label: "Organizar biografia" },
  { id: "destaques", label: "Organizar destaques" },
  { id: "foto", label: "Organizar foto de perfil" },
  { id: "primeiro_mes", label: "Primeiro mês planejado" },
];
export type OnboardingItem = { id: string; label: string; done: boolean };

export function onboardingOf(raw: unknown): OnboardingItem[] {
  const list = Array.isArray(raw) ? (raw as Array<Partial<OnboardingItem>>) : [];
  if (!list.length) return defaultOnboarding.map((s) => ({ ...s, done: false }));
  return list.filter((x) => typeof x?.id === "string" && typeof x?.label === "string").map((x) => ({ id: x.id!, label: x.label!.slice(0, 80), done: Boolean(x.done) }));
}

/** "Ficha do cliente": the brand sheet the whole team reads before producing. */
export const profileFields: Array<{ key: string; label: string; hint?: string; rows?: number }> = [
  { key: "sobre", label: "Sobre o cliente", hint: "O que faz, diferenciais, serviços principais.", rows: 3 },
  { key: "publico", label: "Público-alvo", hint: "Quem é, o que busca, dores e objeções.", rows: 3 },
  { key: "tom", label: "Tom de voz", hint: "Ex.: próximo e técnico; usa “você”; sem gírias.", rows: 3 },
  { key: "paleta", label: "Paleta de cores e fontes", hint: "Ex.: #0F172A, #C6FF34 · títulos em Montserrat.", rows: 2 },
  { key: "pode", label: "Pode e não pode", hint: "Temas, palavras e promessas a evitar; regras do conselho de classe.", rows: 3 },
  { key: "referencias", label: "Referências", hint: "Perfis e posts que o cliente gosta (links).", rows: 2 },
  { key: "acessos", label: "Onde ficam os acessos", hint: "Ex.: “no cofre de senhas da agência”. Não guarde senhas aqui.", rows: 2 },
  { key: "observacoes", label: "Observações", rows: 3 },
];
