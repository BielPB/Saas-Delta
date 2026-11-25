# Arquitetura — Delta Flow

## Visão geral

```
Navegador (Next.js App Router, React 19)
   │  Server Components / Server Actions / Route Handlers  (Vercel)
   │        │ JWT do usuário (RLS sempre ativa)
   │        ▼
   │   Supabase: Postgres 15+ · Auth · Storage (bucket privado) · Realtime
   │        ▲ service role (apenas: URLs assinadas do portal, tokens do Drive, cron, worker)
   │        │
   └── Upload TUS direto ao Storage (bytes nunca passam pelo servidor Next)

Worker (Render/Fly/VM, Node + ffmpeg) ── fila background_jobs (SKIP LOCKED)
   ├─ send_email  → Resend
   └─ generate_preview → Drive/Storage → ffmpeg H.264 720p → Storage privado

Google Drive API (OAuth, drive.readonly) ── somente leitura, referências por ID oficial
```

## Decisões técnicas (e por quê)

| Decisão | Justificativa |
|---|---|
| **Regras de negócio no Postgres** (funções `SECURITY DEFINER` em `0005_workflow.sql`) | Toda transição de estado é atômica, travada (`FOR UPDATE`) e idempotente, e vale para qualquer cliente da API, não só para a interface. A UI não consegue gerar estado inconsistente nem por bug. |
| **RLS + FKs compostas `(workspace_id, id)`** | Isolamento multi-tenant em duas camadas: RLS filtra o que cada usuário vê; FK composta impede, até para o dono do banco, que uma linha aponte para pai de outro workspace. |
| **Gatilhos de guarda de estado** | Colunas de status só mudam dentro das RPCs (que ligam `app.state_change`). UPDATE direto via API é rejeitado. Permissão não é só visual. |
| **`cacheComponents` desligado, `dynamic = "force-dynamic"`** | Tudo é por usuário e por permissão. Renderização por requisição elimina risco de cache compartilhado servir dados de um membro a outro. |
| **Sem `next/image` para mídia privada** | O otimizador de imagens mantém cache compartilhado. Mídia de cliente (inclusive imagens de pacientes) usa URL assinada curta direto do Storage. |
| **Upload TUS direto ao Storage** | Arquivos de 2 GB+ não passam por função serverless; retomada por chunk de 6 MB. A RLS de `storage.objects` é a autorização dos bytes. |
| **Portal anônimo via RPC** | O cliente não tem conta. `portal_*` valida token (hash SHA-256), expiração, revogação, PIN (bcrypt) e sessão curta no banco antes de devolver qualquer dado. `anon` não tem acesso a nenhuma tabela. |
| **Formulários nativos + Server Actions + Zod** | Menos dependências que React Hook Form, funciona sem JS para os fluxos principais; validação replicada no banco. |
| **Componentes próprios no estilo shadcn** | O registro do shadcn não estava acessível no ambiente; os componentes foram escritos à mão com `<dialog>` nativo (foco, Esc e inert gratuitos). |
| **Gráficos em CSS, série única** | Sem biblioteca de chart: magnitude com uma cor, tooltip por barra e tabela para leitor de tela. |

## Módulos de código

```
src/app/(auth)/            login, cadastro, recuperação/definição de senha
src/app/onboarding/        criação do workspace (passo 1 de 10)
src/app/app/**             área autenticada (rotas em pt-BR)
src/app/aprovacao/[token]  portal público do cliente (noindex, no-store)
src/app/api/**             Drive OAuth, cron, exportação CSV
src/lib/auth.ts            Data Access Layer (sessão, workspace ativo, permissões)
src/lib/data.ts            consultas tipadas e filtros por URL
src/lib/portal.ts          sessão do portal, assinatura de mídia, rate limit
src/lib/drive/*            OAuth, AES-256-GCM, cliente Drive com backoff
supabase/migrations/*      schema, RLS, workflow, consultas, storage, fila
worker/*                   processamento assíncrono
tests/db, tests/unit       testes
```

## Renderização e cache
- Todas as rotas são dinâmicas. Dados vêm do Postgres com o JWT do usuário.
- Mutação → Server Action → RPC → `revalidatePath`.
- Realtime: `notifications`, `content_items` e `tasks` publicados; Postgres Changes respeitam RLS.
- Service worker só para instalação (PWA) e push. **Nenhum cache offline** de páginas, API ou mídia.

## Armazenamento — recomendação para ~12 clientes e ~100 vídeos/mês

### Premissas (validar com a operação real)
| Item | Premissa |
|---|---|
| Duração média de um Reels final | 60 s (faixa 30–90 s) |
| Exportação final | 1080×1920 H.264 ~10 Mbps → ~75 MB por vídeo |
| Preview do portal | 720p H.264 CRF 24 → ~20 MB por vídeo (medido: 3 s de teste = 0,42 MB) |
| Capas/artes | ~1 MB cada, ~150/mês |
| Material bruto | **permanece no Google Drive** (não conta no Storage) |
| Retenção quente | 12 meses; depois arquivar/remover finais (política configurável) |
| Visualizações | ~8 por vídeo (cliente + equipe) + 1 download do final pelo social media |

### Estimativa
- Entrada no Storage: (75 + 20) MB × 100 + 0,15 GB ≈ **9,7 GB/mês** → ~**116 GB** no 12º mês.
- Saída (egress): 8 × 20 MB × 100 + 7,5 GB ≈ **~24 GB/mês**.

### Custo (preços consultados em 24/11/2026)
- **Supabase Pro**: US$ 25/mês, inclui 100 GB de Storage (excedente US$ 0,021/GB) e 250 GB de egress (excedente US$ 0,09/GB). No cenário acima: dentro da franquia até ~o 10º mês; no 12º mês, ~16 GB excedentes ≈ US$ 0,35/mês. Egress bem abaixo da franquia.
- Arquivo único: Free limita a 50 MB; **Pro permite configurar até 500 GB**. Configure o *Global file size limit* ≥ 5 GB (o bucket já está em 5 GB).
- **Cloudflare R2** (alternativa futura): US$ 0,015/GB-mês, egress gratuito, US$ 4,50/milhão de escritas e US$ 0,36/milhão de leituras.

### Recomendação
1. **Agora:** Supabase Storage (bucket privado) para finais, capas e previews; Drive para bruto; textos no banco. Custo marginal praticamente zero sobre o plano Pro, uma única fronteira de segurança (RLS) e upload retomável nativo.
2. **Migrar para R2** quando o armazenamento passar de ~500 GB ou o egress de ~250 GB/mês (ex.: se a agência decidir subir bruto pela plataforma: ~25 gravações × 8 GB ≈ 200 GB/mês). A camada `file_assets.provider` já isola o provedor.
3. **Mux/Cloudflare Stream** só se houver necessidade de streaming adaptativo (HLS) para vídeos longos; para Reels de 60 s, MP4 com `faststart` resolve.
4. Worker: plano pago de *background worker* do Render (ou VM pequena) com ffmpeg — confirme o preço vigente antes de contratar.
