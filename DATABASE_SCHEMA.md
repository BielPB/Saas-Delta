# Modelo de dados

Migrations versionadas em `supabase/migrations` (aplicar em ordem). Todas as tabelas de tenant têm `workspace_id`; pais expõem `UNIQUE (workspace_id, id)` para FKs compostas.

| Migration | Conteúdo |
|---|---|
| 0001_foundation | enums, workspaces, settings, profiles (gatilho de auth.users), membros, permissões, funções |
| 0002_domain | clientes, alocação, subdivisões (`client_services`), formatos, templates, metas, conteúdos, responsáveis, arquivos, entregáveis, versões, tarefas, dependências, comentários |
| 0003_approvals_ops | lotes, itens, links, sessões do portal, respostas, solicitações de ajuste, notificações, preferências, push, fila de jobs, logs, Drive |
| 0004_security | helpers de autorização, gatilhos de guarda, RLS, grants |
| 0005_workflow | RPCs de negócio (ver BUSINESS_RULES.md) |
| 0006_queries_storage | dashboard, progresso, relatórios, busca, sugestões, bucket e políticas de Storage, grants finais |
| 0007_realtime | publicação Realtime |
| 0008_rate_limit | limitador e housekeeping |
| 0009_drive_mapping_ref | origem de cada referência do Drive |
| 0010_settings_roles | colunas editáveis do workspace, funções personalizadas |
| 0011_job_queue | claim/finish com SKIP LOCKED e backoff |
| 0013_simple_workflow | categorias de clientes, `work_status`, `editor_id`, `set_work_status`, `submit_for_approval` |
| 0014_client_profile_targets | `clients.onboarding` (checklist), `clients.profile` (ficha), `workspace_members.monthly_target` + `set_member_target` |
| 0015_month_link | `approval_batches.period_month`, `send_month_feed` (um link por cliente/mês) |
| 0016_board_status | `work_status` = colunas do pipeline (script/capture/editing/finishing) |
| 0017_task_advances_post | gatilho: concluir tarefa com `step_key` avança o post |
| 0018_google_calendar | `calendar_connections` (por pessoa), `calendar_credentials` (tokens cifrados, só service role), `calendar_event_links` |
| 0019_feed_order | `content_items.feed_position`, `reorder_feed`, `reset_feed_order`, `reflow_feed` |
| 0012_table_grants | GRANT explícito das tabelas a `authenticated`/`service_role` (projetos Supabase novos não concedem por padrão) e reaplicação das restrições de coluna de 0004/0010 |

## Ajustes em relação à proposta do briefing
| Proposta | Decisão | Motivo |
|---|---|---|
| `publication_schedules` | campos em `content_items` (`planned_publish_at`, `scheduled_at`, `published_at`…) + histórico em `activity_logs` | um agendamento ativo por conteúdo na v1; histórico completo preservado nos logs |
| `deliverable_versions.file` | `deliverable_version_assets` (N arquivos por versão) | carrossel tem vários slides por versão |
| `approval_links` | + `approval_link_sessions` | PIN validado uma vez, sessão curta sem reenviar PIN |
| — | `content_formats` | formatos personalizáveis com entregáveis obrigatórios e proporção |
| — | `drive_credentials` separado de `drive_connections` | tokens em tabela sem nenhuma política RLS |
| — | `private.rate_limits` | rate limit sem dependência externa |

## Integridade e concorrência
- `content_items.lock_version`: concorrência otimista nas edições (`updateContent` exige a versão lida).
- RPCs fazem `SELECT … FOR UPDATE` no registro afetado.
- Unicidade: um passo de template por conteúdo, uma solicitação de ajuste aberta por versão, uma tarefa por solicitação, `(link, idempotency_key)` nas respostas, `(user, dedupe_key)` nas notificações, `(workspace, drive_file_id)` nos arquivos, `idempotency_key` nos jobs, uma sincronização em execução por pasta.
- Exclusão lógica: `archived_at` em clientes, conteúdos e arquivos; clientes também têm status.

## Gerar tipos TypeScript
Com o projeto vinculado: `npx supabase gen types typescript --linked > src/lib/database.types.ts`. A v1 usa interfaces escritas à mão em `src/lib/data.ts`.
