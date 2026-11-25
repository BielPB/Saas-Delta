# Instruções para agentes de código (Delta Flow)

Leia antes de alterar: BUSINESS_RULES.md, SECURITY.md, AGENTS.md (Next 16 tem APIs diferentes; consulte `node_modules/next/dist/docs`).

## Regras inegociáveis
- Regras de estado vivem no Postgres (`supabase/migrations/*_workflow.sql`). Não reimplemente transições no front; chame a RPC.
- Nunca edite uma migration já aplicada: crie uma nova.
- Toda tabela nova de tenant: `workspace_id`, `UNIQUE (workspace_id, id)`, FKs compostas, RLS habilitada com políticas explícitas, grants revisados (anon não acessa tabelas).
- Colunas de status só mudam via função que chama `private.allow_state_change()`.
- O cliente service role (`src/lib/supabase/admin.ts`) só é usado após checagem de permissão do usuário, e nunca com IDs vindos do cliente sem essa checagem.
- Mídia privada: URL assinada curta, `<img>`/`<video>` simples, nunca `next/image`. Service worker sem cache.
- Nada de dados fictícios fora de `supabase/seed.sql` (local) e dos testes.
- Contagens de indicadores são de conteúdos, não de entregáveis.
- UI em pt-BR; fuso padrão America/Fortaleza; use `fromLocalInput`/`toLocalInput`.

## Antes de concluir qualquer mudança
`npm run typecheck && npm run lint && npm test && npm run build`. Não ignore erros de TypeScript nem testes falhando. Atualize IMPLEMENTATION_STATUS.md.

## Convenções
Rotas em pt-BR em `src/app/app/*`. Server Actions em `actions.ts` ao lado da página, retornando `ActionResult`. Erros do banco passam por `friendlyError`. Filtros vivem na URL. Componentes base em `src/components/ui`; tokens semânticos em `globals.css` (nunca hex solto em componente; Lime só para ação primária/destaque).
