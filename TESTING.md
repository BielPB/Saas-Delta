# Testes

```bash
npm test            # unit + banco
npm run test:unit
npm run test:db     # recria o banco de teste a partir das migrations
npm run typecheck && npm run lint && npm run build
```

## Banco (`tests/db`) — 23 testes
Postgres 15+ real com um shim mínimo do Supabase (`tests/db/supabase-shim.sql`: roles `anon/authenticated/service_role`, `auth.users`, `auth.uid()`, `storage`). Cada teste roda **como o papel real** (`SET LOCAL ROLE` + `request.jwt.claim.sub`), com RLS ativa.

Configuração: `TEST_DATABASE_ADMIN_URL` (padrão `postgres://postgres:postgres@localhost:5432/postgres`). `SKIP_DB_RESET=1` reaproveita o banco.

| Critério do briefing | Teste |
|---|---|
| 1 Produção | dependências bloqueiam, entrega obrigatória, liberação e notificação do editor; conclusão idempotente |
| 2 Google Drive | referência importada uma vez (unicidade), vinculada ao conteúdo correto |
| 3 Aprovação | lote de 8 conteúdos aberto sem cadastro; internos nunca expostos; `anon` sem acesso a tabelas |
| 4 Reprovação parcial | vídeo e capa aprovados, legenda reprovada; tarefa só para o copywriter; produção não reiniciada |
| 5 Versionamento | V2 no mesmo link após revisão; V1 e a reprovação preservadas |
| 6 Publicação | agendar, confirmar, data futura recusada, indicadores; exceção sem aprovação exige permissão e é auditada; data passada não vira publicado |
| 7 Segurança | colaborador não alocado: consulta, URL/RPC, UPDATE e upload no Storage bloqueados; status não muda por UPDATE |
| 8 Isolamento | agência B não lê, escreve, busca nem referencia dados da A; FK composta barra até o dono do banco |
| 9 Upload | política de Storage por cliente (a retomada TUS é do cliente `tus-js-client`; ver pendências) |
| 10 Consistência | mesmo evento duas vezes ⇒ uma resposta, uma tarefa |
| 11 Expiração | expirado, revogado e token inexistente ⇒ sem acesso |
| 12 Versão desatualizada | decisão em versão substituída ⇒ `stale_version` |
| Extras | PIN obrigatório e bloqueio após 5 erros; reverter reprovação exige confirmação; aprovação em massa não sobrescreve reprovados; invalidação; funções personalizadas; colunas protegidas do workspace; fila de jobs |

## Unitários (`tests/unit`) — 10 testes
Transições do Kanban, status editorial e atraso, fuso America/Fortaleza, CSV contra injeção de fórmula, sanitização de caminho de storage, mapeamento de erros, AES-256-GCM (incluindo adulteração).

## Verificações manuais realizadas
- Build de produção, lint e typecheck sem erros.
- Telas públicas renderizadas em Chrome headless (desktop/mobile, claro/escuro), sem erros de console: `scripts/e2e/smoke-public.mjs` (requer `next start` na porta 3100).
- Worker: transcodificação de vídeo HEVC 1080×1920 → H.264 720×1280 com proporção preservada.

## Pendências (honestas)
- **E2E autenticado (Playwright)** contra um Supabase real: não foi possível subir Supabase/PostgREST neste ambiente. Os embeds do PostgREST (FKs compostas com nomes de constraint) e as páginas logadas precisam ser exercitados no primeiro ambiente de staging. Roteiro sugerido em IMPLEMENTATION_STATUS.md.
- Teste automatizado de retomada de upload interrompido (requer Storage real).
- Testes de responsividade das telas autenticadas e auditoria com axe.
- Medição real do carregamento do portal em 4G (meta < 3 s).
