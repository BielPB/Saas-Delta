# Delta Flow

Plataforma de operações de marketing para agências: produção de conteúdo com pipeline e dependências reais, aprovação do cliente por link seguro (sem cadastro), versionamento, calendário editorial e indicadores. **Da criação à publicação, tudo em um único fluxo.**

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Supabase (Postgres, Auth, Storage, Realtime, RLS) · Google Drive API · Resend · worker Node + ffmpeg.

## Rodar localmente
```bash
npm install
cp .env.example .env.local          # preencha Supabase (local ou nuvem)
npx supabase start                  # opcional: stack local (Docker)
npx supabase db reset               # aplica migrations + seed de demonstração (só local)
npm run dev                         # http://localhost:3000
```
Sem as variáveis do Supabase o app mostra a tela "Configuração pendente" (não há modo fictício).

## Scripts
| Script | Uso |
|---|---|
| `npm run dev` / `build` / `start` | aplicação |
| `npm run typecheck` / `lint` | qualidade |
| `npm test` | unitários + banco (precisa de Postgres local, ver TESTING.md) |
| `npm run worker` | worker de e-mail e preview |

## Documentação
[ARCHITECTURE](ARCHITECTURE.md) (inclui recomendação de armazenamento e custos) · [DATABASE_SCHEMA](DATABASE_SCHEMA.md) · [BUSINESS_RULES](BUSINESS_RULES.md) · [API_DOCUMENTATION](API_DOCUMENTATION.md) · [SECURITY](SECURITY.md) · [DESIGN_SYSTEM](DESIGN_SYSTEM.md) · [DEPLOYMENT](DEPLOYMENT.md) · [TESTING](TESTING.md) · [ROADMAP](ROADMAP.md) · [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md) · [CLAUDE](CLAUDE.md)

Código, banco, domínio e ambientes pertencem à Delta.
