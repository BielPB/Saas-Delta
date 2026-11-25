# Design system

## Princípios
Densidade de ferramenta de trabalho (referência: Linear, Vercel): bordas finas, raio 4–8 px, sombra só em camadas flutuantes, tipografia como hierarquia. **Lime (#C6FF34) é destaque estratégico**, nunca cor dominante: ação primária, foco no tema escuro, item ativo da navegação, "pronto para publicar", progresso que atingiu a meta.

## Tokens (`src/app/globals.css`)
Semânticos, com valores próprios para claro e escuro (o escuro é desenhado, não invertido).

| Token | Uso |
|---|---|
| `bg`, `surface`, `surface-2`, `surface-3` | fundo, painéis, hover/realce, trilhos |
| `border`, `border-strong` | divisórias, hover de campos |
| `fg`, `muted` (6,1:1 no claro), `subtle` | texto principal, secundário, terciário |
| `accent`, `accent-fg` (16,8:1), `accent-soft`, `accent-ink` | lime e textos sobre ele |
| `ring` | foco visível (carbon no claro, lime no escuro) |
| `--tone-{neutral,info,progress,warning,danger,success,accent}-{bg,fg}` | badges de status (sempre com texto, nunca só cor) |
| `radius-sm/md/lg` | 4 / 6 / 8 px |

Tipografia: Geist Sans (interface) e Geist Mono (códigos `#12`, chaves). Base 13–14 px nas telas densas, 15 px no portal; números com `tabular-nums`.

## Componentes (`src/components/ui`)
`Button` (primary/secondary/ghost/danger/subtle; sm/md/icon) · `ButtonLink` · `Input`, `Textarea`, `Select`, `Checkbox` · `Field` (label + hint + erro com `aria-describedby`) · `SubmitButton` (estado pendente) · `FormError` · `Badge` · `Panel` · `PageHeader` · `EmptyState` · `Skeleton` · `Avatar` · `Progress` · `Stat` (indicador clicável) · `Table` · `LinkTabs` (abas por URL) · `Dialog` (`<dialog>` nativo) · `Menu`/`MenuItem` · `Tooltip` (hover e foco) · `Toast` (feedback de toda ação).

Domínio: badges de status, `ContentTable`, `Thumb` (respeita proporção), `PipelineBoard`, `CalendarMonth`, `PublicationDialog`, `Uploader` (TUS), `FilterBar` (filtros na URL + persistidos), `CommandPalette` (⌘K).

## Acessibilidade
Link "Pular para o conteúdo"; foco visível em tudo; navegação por teclado no menu, diálogos e busca (setas/Enter); labels reais (nunca placeholder como label); `aria-live` em progresso e uploads; `prefers-reduced-motion` respeitado; alvo de toque ≥ 44 px no portal; status sempre com texto. Pendência: auditoria completa com leitor de tela e axe.

## Gráficos
Série única de magnitude em um tom, barras finas com ponta arredondada ancorada na base, tooltip por marca e tabela equivalente para leitor de tela. Sem paleta categórica, portanto sem legenda.
