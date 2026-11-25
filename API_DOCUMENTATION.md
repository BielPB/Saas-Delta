# API

A aplicação usa Server Actions; a API pública é o PostgREST do Supabase protegido por RLS. Erros de negócio vêm como exceção com prefixo:

| Prefixo | Significado | HTTP sugerido |
|---|---|---|
| `permission_denied` | sem permissão | 403 |
| `not_found` | inexistente ou invisível (não revela existência) | 404 |
| `invalid_transition`, `dependencies_pending`, `adjustments_pending` | transição proibida | 409 |
| `stale_version` | decisão sobre versão substituída | 409 |
| `deliverable_missing`, `comment_required`, `validation` | entrada inválida | 422 |
| `approval_required` | agendar sem aprovação | 409 |
| `link_unavailable`, `session_invalid` | link expirado/revogado, sessão do portal | 410 / 401 |

## RPCs autenticadas (`authenticated`)
`create_workspace(name, slug)` · `accept_pending_invites()` · `invite_member(ws, email, role_keys[])` · `set_member_roles(ws, member, role_keys[])` · `set_member_status(ws, member, active)` · `my_permissions(ws)` · `save_role(...)` · `delete_role(ws, key)`

`create_content(ws, client, format, title, fields jsonb, assignees jsonb)` · `duplicate_content(id, title)` · `cancel_content(id, reason)`

`start_task(id)` · `send_task_to_review(id)` · `complete_task(id)` · `reopen_task(id, reason)` · `cancel_task(id, reason)`

`add_deliverable_version(deliverable, text, asset_ids[], external_url, reason)` · `invalidate_approval(deliverable, reason)`

`create_approval_batch(ws, client, name, content_ids[], due_at, expires_at, pin)` → `{batch_id, link_id, token, expires_at}` · `revoke_approval_link(link)` · `rotate_approval_link(batch, expires_at, pin)`

`schedule_publication(content, at, channel, override_reason)` · `move_publication(content, at)` · `unschedule_publication(content)` · `confirm_publication(content, published_at, url)`

Leitura (SECURITY INVOKER, RLS aplicada): `dashboard_summary(ws, from, to, client, service, format, member)` · `dashboard_attention(ws)` · `client_progress(ws, month, client)` · `team_workload(ws)` · `report_clients|report_members|report_agency(ws, from, to)` · `search_global(ws, q)` · `suggest_asset_links(asset)`

## Portal (`anon`)
`portal_open(token, pin)` → `{ok, session}` ou `{ok:false, error: pin_required|pin_invalid|locked}`
`portal_get(token, session)` → lote, itens, versão liberada mais recente por entregável, decisão e histórico
`portal_respond(token, session, version, decision, comment, reviewer, idempotency_key, confirm_override)` → `{status: applied|unchanged|duplicate|override_required}`
`portal_bulk_approve(token, session, content|null, reviewer, idempotency_key, include_rejected)`
`portal_finalize(token, session, reviewer)` → resumo

## Service role
`run_deadline_scan()` · `run_housekeeping()` · `rate_limit_hit(bucket, max, window)` · `claim_background_jobs(types[], limit)` · `finish_background_job(id, ok, error)` · `release_stale_jobs()`

## Route Handlers
| Rota | Uso |
|---|---|
| `GET /api/drive/connect` | inicia OAuth (exige integrations.manage) |
| `GET /api/drive/callback` | troca o código, cifra e grava tokens |
| `GET /api/relatorios/{clientes|colaboradores}?de&ate` | CSV (reports.view) |
| `GET /api/cron/deadlines` | `Authorization: Bearer CRON_SECRET` |
| `GET /auth/callback` | PKCE (OAuth, convite, recuperação) |
