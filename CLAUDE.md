# Instruções para agentes de código (Delta Flow)

Leia antes de alterar: BUSINESS_RULES.md, SECURITY.md, AGENTS.md (Next 16 tem APIs diferentes; consulte `node_modules/next/dist/docs`). Estado do produto: IMPLEMENTATION_STATUS.md. Banco: DATABASE_SCHEMA.md. Infra: DEPLOYMENT.md.

## Com quem você fala
- O dono do projeto, Gabriel, **não é desenvolvedor**. Responda sempre em **português do Brasil**, de forma simples, e guie passo a passo o que ele precisar fazer (Supabase, Vercel, Google Cloud, terminal).
- Ele trabalha às vezes no Mac (`/Users/gabrielmarques/Downloads/delta-flow`), às vezes no Windows (`c:\Users\Biel\Desktop\Saas-Delta`). O GitHub é a ponte: no início da sessão, confira se a pasta está em dia (`git status`, `git pull`); no fim, garanta que nada ficou sem enviar.
- Ele manda prints. Quando algo quebra em produção, peça a linha vermelha da aba **Logs** da Vercel.
- **Custo zero por enquanto**: Supabase Free, Vercel Hobby. Não proponha serviços pagos sem avisar.
- **Nunca peça chaves/segredos no chat.** Ele cola direto no `.env.local` ou na Vercel. Não tente ler o `.env.local`.

## Infraestrutura
- GitHub: `BielPB/Saas-Delta`, branch `main`.
- Produção: https://saasdelta.vercel.app (Vercel Hobby, região `gru1`). **Todo push na `main` publica no ar.** Trabalho pela metade vai para outra branch.
- Supabase Free, projeto em São Paulo, ref `dbwqgkwcskzujbxntgsq` (vincular com `npx supabase link --project-ref dbwqgkwcskzujbxntgsq` se a pasta ainda não estiver vinculada).
- Variáveis na Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DRIVE_TOKEN_ENCRYPTION_KEY`. Ainda não: `RESEND_API_KEY`, `EMAIL_FROM`.
- Google Cloud em modo **Teste** (usuários de teste; autorização expira a cada 7 dias). Redirect: `https://saasdelta.vercel.app/api/calendar/callback`.
- Cron diário `/api/cron/deadlines` (8h de Brasília), protegido por `CRON_SECRET`.

## Fluxo de trabalho
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pode dar `git push` na `main` em correções e pedidos do Gabriel.
- **Migrations** (`supabase/migrations/`): ao criar uma nova, faça o commit **sem push**, peça para o Gabriel rodar `npx supabase db push --remote` na pasta do projeto (conferir que o Target é o projeto de São Paulo e que só aparece a migration nova) e só depois faça o push. O código nunca vai ao ar antes da migration.

## Regras inegociáveis
- Regras de estado vivem no Postgres (`supabase/migrations/*_workflow.sql`). Não reimplemente transições no front; chame a RPC.
- Nunca edite uma migration já aplicada: crie uma nova.
- Toda tabela nova de tenant: `workspace_id`, `UNIQUE (workspace_id, id)`, FKs compostas, RLS habilitada com políticas explícitas, grants revisados (anon não acessa tabelas). Projetos novos do Supabase **não dão GRANT automático**: toda tabela nova precisa de `grant` explícito (ver migration 0012).
- Colunas de status só mudam via função que chama `private.allow_state_change()`.
- O cliente service role (`src/lib/supabase/admin.ts`) só é usado após checagem de permissão do usuário, e nunca com IDs vindos do cliente sem essa checagem.
- **Server Components não podem importar funções/valores comuns de arquivos `"use client"`** (vira referência vazia, "x is not a function"; já derrubou produção 2 vezes). Helpers compartilhados vão em `src/lib/`. O teste `tests/unit/client-boundary.test.ts` barra isso.
- Mídia privada: URL assinada curta, `<img>`/`<video>` simples, nunca `next/image`. Service worker sem cache. Upload direto limitado a 50 MB (Supabase Free); vídeos grandes vão por link do Google Drive.
- Nada de dados fictícios fora de `supabase/seed.sql` (local) e dos testes.
- Contagens de indicadores são de conteúdos, não de entregáveis.
- UI em pt-BR; fuso padrão America/Fortaleza; use `fromLocalInput`/`toLocalInput`.

## Antes de concluir qualquer mudança
`npm run typecheck && npm run lint && npm run test:unit && npm run build`. (`npm test` inclui testes de banco que exigem Supabase local.) Não ignore erros de TypeScript nem testes falhando. Atualize IMPLEMENTATION_STATUS.md (e BUSINESS_RULES.md / DATABASE_SCHEMA.md quando a regra ou o banco mudar).

## Convenções
Rotas em pt-BR em `src/app/app/*`. Server Actions em `actions.ts` ao lado da página, retornando `ActionResult`. Erros do banco passam por `friendlyError`. Filtros vivem na URL. Componentes base em `src/components/ui`; tokens semânticos em `globals.css` (nunca hex solto em componente; Lime só para ação primária/destaque).

## Pendências (em ordem sugerida)
1. **E-mail com Resend** (convites, recuperar senha, avisos). Bloqueio: domínio próprio. Plano: verificar domínio no Resend → SMTP do Supabase Auth (smtp.resend.com:465, usuário `resend`) → mover o envio de avisos (hoje num worker que só roda local) para o Supabase (pg_cron + pg_net). Enquanto isso, a equipe entra por convite em Equipe + **“Gerar acesso”** (menu … do convidado): cria o login com senha provisória para mandar pelo WhatsApp (`generateAccess` em `colaboradores/actions.ts`; nunca altera conta que já entrou no sistema). O e-mail embutido do Supabase Free não entrega para endereços de fora da equipe do projeto.
   Sem e-mail, **“Esqueci minha senha” também não chega**: um membro ativo que esquece a senha fica sem saída (o “Gerar acesso” só vale para convidados). Domínio .com.br ≈ R$ 40/ano é o único gasto recomendado.
2. **Trocar senha obrigatória no primeiro login** depois do “Gerar acesso” (hoje só é sugerido). Mudança pequena, sugerida em 2026-11-26.
3. **Backup semanal gratuito** do banco (o Supabase Free não oferece backup para baixar). Ideia: GitHub Action agendada com `pg_dump`, guardando o arquivo fora do repositório público. Sugerido em 2026-11-26.
4. **Piloto** com 1–2 pessoas da equipe num cliente real (adicionar o Gmail delas em Usuários de teste do Google). Fazer o roteiro completo (post → etapas → aprovação no celular → reprovar → corrigir → aprovar → publicar) e conferir as telas num celular de verdade: nada foi testado em aparelho real nem com cliente real.
5. Domínio próprio também destrava links do cliente com o endereço da agência e verificação do app no Google.
6. Pequenos: remover o campo "Pasta do Drive (ID)" do cadastro de subdivisão; conteúdos antigos criados com template continuam no fluxo de tarefas encadeadas (não arrastam no pipeline).
7. Funções faltando: envio do Web Push pelo worker, MFA, exportar PDF/Excel.
8. Riscos de custo zero para acompanhar: Storage grátis tem 1 GB no total (vídeos grandes já vão por link do Drive, imagens enchem aos poucos); a Vercel Hobby é para uso não comercial.
9. Fora do escopo por enquanto: métricas de redes sociais, IA, financeiro, "Programar todos".

Mantenha esta lista em dia quando uma pendência for resolvida ou surgir outra.
