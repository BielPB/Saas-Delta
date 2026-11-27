# Implantação

Tudo em contas da Delta (código no GitHub privado, Supabase, Vercel, Google Cloud, Resend, domínio).

## 1. Supabase (plano Pro recomendado)
1. Crie o projeto (região `sa-east-1`).
2. `npx supabase login && npx supabase link --project-ref <ref>`
3. `npx supabase db push` (aplica `supabase/migrations` em ordem).
4. Storage → Settings → **Global file size limit ≥ 5 GB** (o bucket `workspace-files` é criado pela migration, privado, 5 GB).
5. Auth → URL Configuration: Site URL `https://app.deltaflow.com.br`; Redirect URLs `https://app.deltaflow.com.br/auth/callback`.
6. Auth → Providers → Google (opcional, para login): mesmo cliente OAuth do Google Cloud; depois `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`.
7. Auth → SMTP: configure o Resend como SMTP para os e-mails de convite/recuperação.
8. Database → Backups: habilite PITR e teste uma restauração.

## 2. Google Cloud (Drive)
1. Ative a Google Drive API.
2. Tela de consentimento OAuth (externa); escopos `openid`, `email`, `drive.readonly`. `drive.readonly` é escopo restrito: para uso fora da própria organização Google o app precisa passar pela verificação do Google.
3. Credencial "Aplicativo da Web", redirect `https://app.deltaflow.com.br/api/drive/callback`.
4. Gere a chave de cifra: `openssl rand -base64 32` → `DRIVE_TOKEN_ENCRYPTION_KEY` (guarde em cofre; perdê-la exige reconectar o Drive).

## 2b. Google Agenda (por pessoa)
1. No mesmo projeto do Google Cloud, ative a **Google Calendar API**.
2. Google Auth Platform → **Acesso a dados**: adicione o escopo `https://www.googleapis.com/auth/calendar.events`.
3. **Público-alvo**: Externo. Em **Teste**, adicione o Gmail de cada pessoa em *Usuários de teste* (máx. 100; autorização expira a cada 7 dias até o app ser verificado).
4. **Clientes** → cliente Web → URI de redirecionamento: `https://<seu-domínio>/api/calendar/callback` (Minha conta mostra o valor exato).
5. Usa `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `DRIVE_TOKEN_ENCRYPTION_KEY` (a mesma chave cifra os tokens do Drive e da Agenda).

## 3. Vercel
Variáveis: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL` (endereço público, sem barra final), `CRON_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DRIVE_TOKEN_ENCRYPTION_KEY`, `NEXT_PUBLIC_MAX_UPLOAD_MB` (50 no Supabase Free; vídeos grandes vão por link do Google Drive), `NEXT_PUBLIC_GOOGLE_API_KEY` (chave de API do Google Cloud restrita à Google Drive API; faz os vídeos do Drive tocarem no player do aparelho, inclusive no iPhone; lida pelo servidor a cada página, basta estar marcada para Production e haver um deploy depois de criada), `RESEND_API_KEY` e `EMAIL_FROM` (quando houver domínio). Variáveis `NEXT_PUBLIC_*` só valem após novo deploy.
1. Importe o repositório; defina as variáveis do `.env.example` (Production e Preview separados).
2. `CRON_SECRET` com `openssl rand -hex 32`; o `vercel.json` agenda `/api/cron/deadlines` uma vez por dia, às 8h (limite do plano Hobby; no Pro pode voltar a ser de hora em hora). Região das funções: `gru1` (São Paulo), junto do Supabase.
3. Domínio `app.deltaflow.com.br`.

## 4. Worker (Render ou equivalente)
- Serviço "Background Worker", Node 22, imagem com ffmpeg (ex.: Dockerfile `node:22-slim` + `apt-get install ffmpeg`).
- Comando: `node worker/index.mjs`. Variáveis: Supabase URL + service role, Resend, Google, chave de cifra, `NEXT_PUBLIC_APP_URL`.
- Pode rodar mais de uma instância (fila com `SKIP LOCKED`).

## 5. Web Push (opcional)
`npx web-push generate-vapid-keys` → `NEXT_PUBLIC_VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`. O envio pelo worker está pendente (ver IMPLEMENTATION_STATUS.md).

## 6. Primeiro acesso
Crie a conta em `/cadastro`, crie o workspace "Agência Delta" e siga a lista de primeiros passos do painel.

## Manutenção
- Novas migrations: arquivo novo em `supabase/migrations` (nunca editar uma já aplicada em produção) → `npx supabase db push`.
- Rotação de `CRON_SECRET` e `RESEND_API_KEY` sem impacto. Rotação de `DRIVE_TOKEN_ENCRYPTION_KEY` exige recifrar ou reconectar contas.
- Monitorar `background_jobs` com status `dead` e `drive_sync_jobs` com falha.
