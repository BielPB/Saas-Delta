# Status de implementação

Legenda: ✅ implementado e testado · 🟢 implementado (validado por typecheck/build; falta exercitar contra Supabase real) · 🟡 parcial · ⏳ pendente · 🔑 depende de credencial externa

## Fase 1 — Fundação
| Item | Status |
|---|---|
| Schema multi-tenant, FKs compostas, RLS, gatilhos de guarda | ✅ (23 testes de banco) |
| Auth: e-mail/senha, recuperação, convite, desativação, sessão | 🟢 |
| Login com Google | 🟢 🔑 (ativar provider + `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`) |
| Funções múltiplas e personalizadas, permissões granulares | ✅ banco · 🟢 UI |
| Design system, tema claro/escuro, sidebar recolhível, ⌘K | 🟢 (telas públicas verificadas no Chrome) |
| MFA | ⏳ |

## Fase 2 — Gestão operacional
| Item | Status |
|---|---|
| Clientes (CRUD, status, arquivar, sensível, equipe alocada) | 🟢 |
| Serviços com cor/meta/pasta; metas por cliente/serviço/formato/mês | 🟢 |
| Página do cliente com 9 abas e tabela operacional por serviço | 🟢 |
| Conteúdos: criação por template, 5 visualizações, filtros persistentes, ações em massa, duplicar, arquivar, cancelar | 🟢 |
| Pipeline com dependências, liberação automática e notificações | ✅ |
| Tarefas: minhas, central, detalhe, checklist, comentários, reabrir/cancelar | ✅ banco · 🟢 UI |
| Dashboard executivo, atenção prioritária, filtros, indicadores clicáveis | ✅ banco · 🟢 UI |
| Onboarding (workspace + checklist de 10 passos que pode ser pulado) | 🟢 |

## Fase 3 — Arquivos e integrações
| Item | Status |
|---|---|
| Upload TUS direto (retomar, pausar, cancelar, progresso, duplicidade, validação) | 🟢 (Storage real necessário para testar retomada) |
| Biblioteca e central de não vinculados com sugestões (nunca automáticas) | ✅ sugestão no banco · 🟢 UI |
| Google Drive: OAuth, pastas → cliente/serviço, sincronização, novos/indisponíveis, sem duplicar | 🟢 🔑 |
| Preview audiovisual (proporção preservada, carrossel, tela cheia, versões) | 🟢 |
| Worker de preview (Drive/Storage → H.264 720p + poster) | ✅ transcodificação · 🟢 fila · 🔑 |
| Versionamento imutável | ✅ |

## Fase 4 — Aprovação
| Item | Status |
|---|---|
| Lotes (único, vários, por serviço, semanal, mensal), link seguro, PIN, expiração, revogação, rotação | ✅ |
| Portal mobile: item a item, observação obrigatória na reprovação, em lote, resumo final | ✅ banco · 🟢 UI (verificado visualmente com dados fictícios) |
| Ajuste automático só para o entregável reprovado; invalidação explícita | ✅ |
| "Todos os conteúdos de uma campanha" | ⏳ não há entidade Campanha na v1; use serviço/período |

## Fase 5 — Controle editorial
| Item | Status |
|---|---|
| Calendário mês/semana/dia/lista, arrastar, conflitos, copiar legenda | 🟢 |
| Planejado ≠ agendado ≠ publicado; atrasado calculado | ✅ |
| Notificações internas, Realtime, preferências, deduplicação | ✅ banco · 🟢 UI |
| E-mails transacionais (Resend via worker) | 🟢 🔑 |
| Web Push | 🟡 assinatura e service worker prontos; **envio pelo worker pendente** (requer `web-push` + VAPID) |
| Relatórios por cliente/colaborador/agência + CSV | ✅ banco · 🟢 UI |
| Exportação PDF/Excel | ⏳ (roadmap) |

## Fase 6 — Validação
| Item | Status |
|---|---|
| Testes de banco (12 critérios + extras) | ✅ 23 |
| Testes unitários | ✅ 10 |
| Typecheck, lint, build de produção | ✅ |
| E2E autenticado com Playwright contra Supabase | ⏳ não executável neste ambiente |
| Medição de performance do portal em 4G | ⏳ |

## Primeiro roteiro em staging (recomendado antes de liberar à equipe)
1. `db push`, criar conta, workspace, 2 clientes, 3 colaboradores com funções diferentes.
2. Criar Reels por template; como copywriter/filmmaker/editor concluir etapas com upload real (inclui interromper a rede no meio de um upload de 1 GB).
3. Revisão interna → lote de 8 → abrir no celular pelo WhatsApp → reprovar legenda → V2 → reaprovar.
4. Agendar, confirmar publicação, conferir dashboard e calendário.
5. Logar como colaborador não alocado e tentar abrir URLs do outro cliente.
6. Conectar o Drive, vincular pasta, sincronizar, vincular arquivo, gerar preview.
Qualquer erro de embed do PostgREST aparece logo no passo 1–3 (nomes de FK em `src/lib/data.ts`).

## Dados de demonstração
Nenhum dado fictício em produção. `supabase/seed.sql` só é aplicado localmente (`supabase db reset`) e é identificado como demonstração.
