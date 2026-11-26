# Regras de negócio e máquina de estados

Fonte da verdade: `supabase/migrations/20261124000005_workflow.sql` (`private.recompute_content`).
Nenhuma coluna de status é gravada diretamente: o gatilho `guard_*` rejeita UPDATE fora das RPCs.

## Entidades
- **Subdivisão** é uma categoria de conteúdo de um cliente (ex.: “Fotona Laser”, “Institucional”). Organiza pipeline, filtros, metas e o menu Projetos. Não tem status próprio: o andamento do trabalho está nas tarefas. No banco e no código é `client_services` / `service_id` (o filtro na URL é `?servico=`); só o nome exibido mudou.
- **Conteúdo** é a entidade central. Tem **entregáveis** (roteiro, material bruto, vídeo, capa, legenda, arte, carrossel).
- Cada entregável tem **versões imutáveis** (V1, V2…). Uma versão nunca é sobrescrita nem apagada.
- **Tarefas** produzem entregáveis e podem depender de outras tarefas (DAG, ciclos rejeitados).
- **Entregável interno**: roteiro e material bruto (nunca vão ao cliente). **Voltado ao cliente**: vídeo, capa, legenda, arte, carrossel.

## Fluxo simples (posts criados pela grade do cliente) — padrão desde a migration 0013
Posts criados em **Cliente → Posts/Reels/Stories** nascem **sem template de tarefas**: só os entregáveis do formato.
- **Status manual = coluna do pipeline** (`content_items.work_status`, 0016): `script` Roteiro → `capture` Gravação → `editing` Edição → `finishing` Finalização. Muda por: arrastar o card no pipeline, seletor no painel do post, ou conclusão de tarefa com etapa (abaixo). Pode mudar quem gerencia conteúdos, os responsáveis, o editor ou quem tem tarefa aberta no post (`set_work_status`).
- **Dali em diante o status é derivado** (aprovação/publicação): Com o cliente, Em ajuste, Pronto para publicar, Agendado, Publicado (`src/lib/post-status.ts`). Coluna **Pronto** do quadro = esses estados (`src/lib/board.ts`).
- **Liberar para aprovação** (`submit_for_approval`, 0013): exige todos os entregáveis obrigatórios com versão; cada ajuste pedido pelo cliente precisa de versão **mais nova** que a reprovada (resolve a solicitação e conclui a tarefa de ajuste); libera as versões atuais para o portal. Substitui a tarefa “Revisão interna” dos templates. Soltar o card em **Pronto** chama a mesma função.
- **Tarefa com etapa avança o post** (0017): tarefa geral ligada a um post com `step_key` ∈ {script, capture, editing, finishing}; ao concluir, o post vai para a etapa seguinte — nunca volta, nunca passa de Finalização, só no fluxo simples (`template_id` nulo).
- **Link do mês** (`send_month_feed`, 0015): um link de aprovação por cliente e mês; reenviar adiciona os posts novos ao mesmo link. A ordem do link segue o preview do feed (`feed_position`, 0019; `reorder_feed`/`reset_feed_order`).
- **Aprovação por imagem**: num item com várias imagens o cliente marca quais precisam de ajuste; a decisão continua sendo da versão inteira e a observação chega como “Imagens 2 e 3: …”.
- Conteúdos antigos criados por template continuam no fluxo de tarefas encadeadas descrito abaixo.

## Metas (todas contam posts aprovados por mês)
| Meta | Onde | Precedência |
|---|---|---|
| Do cliente | `clients.monthly_target` (Configurações do cliente) | padrão de todo mês |
| De um mês específico | `monthly_targets` (aba Subdivisões) | substitui a do cliente naquele mês |
| Da subdivisão | `client_services.monthly_target` | parte da meta do cliente |
| Individual | `workspace_members.monthly_target` (Equipe) | ranking “Meta individual”: posts aprovados no mês em que a pessoa é responsável ou editora |

## Três dimensões de status (derivadas)

### Produção
| Status | Condição |
|---|---|
| Planejado | nenhuma tarefa iniciada e nenhuma versão |
| Em produção | alguma tarefa iniciada/concluída ou alguma versão enviada |
| Revisão interna | todos os entregáveis obrigatórios têm versão e há revisão interna aberta |
| Ajustes | existe solicitação de ajuste aberta |
| Concluído | todos os obrigatórios com versão e revisão interna concluída |

### Aprovação (só entregáveis obrigatórios voltados ao cliente)
| Status | Condição |
|---|---|
| Não enviado | conteúdo ainda não entrou em lote |
| Aguardando avaliação | enviado, nenhum aprovado |
| Parcialmente aprovado | alguns aprovados, nenhum reprovado |
| Reprovado | algum entregável atual reprovado |
| Aprovado | todos aprovados |

### Publicação
| Status | Condição |
|---|---|
| Sem programação | sem data editorial |
| Planejado | tem data editorial (intenção) |
| Pronto para publicar | produção concluída **e** aprovação total |
| Agendado | social media registrou o agendamento (`schedule_publication`) |
| Publicado | confirmação com data efetiva (`confirm_publication`) |
| Cancelado | `cancel_content` |

**Atraso é calculado**, nunca gravado: data editorial/agendada passada sem confirmação ⇒ "Publicação atrasada" / "Aguardando confirmação". Tarefa atrasada = prazo vencido e status aberto (não bloqueada).

## Transições permitidas

| Ação (RPC) | Quem | Pré-condições | Efeitos |
|---|---|---|---|
| `create_content` | contents.manage + acesso ao cliente | cliente ativo, template do mesmo formato | cria entregáveis, tarefas e dependências; sem dependência ⇒ Pendente, com ⇒ Bloqueada |
| `start_task` | responsável ou tasks.manage | não bloqueada | Em andamento |
| `send_task_to_review` | responsável | entregável presente | Em revisão; avisa gestão |
| `complete_task` | responsável (gestão se em revisão) | entregável obrigatório presente; ajuste exige versão **mais nova** que a reprovada; revisão exige todos os obrigatórios e nenhum ajuste aberto | Concluída; libera dependentes cujas dependências terminaram e notifica; revisão libera as versões atuais para o portal; ajuste resolve a solicitação e reabre a revisão |
| `reopen_task` / `cancel_task` | tasks.manage | motivo | reaberta (notifica) / cancelada (libera dependentes) |
| `add_deliverable_version` | gestão, ou responsável com tarefa aberta | texto ou arquivo/link; motivo obrigatório se substitui versão aprovada | nova versão pendente; anterior pendente vira "substituída"; aprovação volta a pendente; histórico preservado |
| `create_approval_batch` | approvals.manage | todos os obrigatórios voltados ao cliente com versão **revisada**; cliente sensível exige PIN e validade ≤ 30 dias | lote + link (token mostrado uma única vez) |
| `portal_respond` | cliente com token+sessão | versão = atual e liberada; reprovação exige justificativa (≥ 3 caracteres) | grava decisão ligada à versão exata; reprovação cria **uma** solicitação de ajuste e **uma** tarefa para o responsável daquele entregável |
| `portal_bulk_approve` | cliente | — | aprova pendentes; **não** sobrescreve reprovados sem `include_rejected` |
| `invalidate_approval` | approvals.invalidate | entregável aprovado; motivo | volta a reprovado internamente, cria ajuste; auditado |
| `schedule_publication` | publications.manage | aprovado e produção concluída; exceção exige `publications.override` + motivo (auditado) | Agendado |
| `confirm_publication` | publications.manage | Agendado ou Pronto; data efetiva não futura | Publicado |
| `move_publication` | publications.manage ou contents.manage | não publicado/cancelado | altera data; se agendado, registra reprogramação |

## Situações impossíveis por construção
- Conteúdo aprovado sem entregáveis obrigatórios aprovados (derivação).
- Tarefa liberada com dependência aberta; tarefa concluída sem entrega.
- Agendar sem aprovação sem exceção autorizada e auditada.
- Publicado sem confirmação (CHECK exige `published_at`).
- Aprovação aplicada à versão errada (`stale_version`).
- Duas tarefas de ajuste para a mesma reprovação (índice único parcial por versão + `idempotency_key`).

## Contagem de indicadores
- Indicadores contam **conteúdos**. Vídeo + capa + legenda de um Reels = 1 conteúdo.
- Data de referência de um conteúdo para filtros de período: `coalesce(planned_publish_at, due_at, created_at)`.
- "Vídeos/capas/legendas prontos" = conteúdos cujo entregável daquele tipo tem versão enviada.
- Meta do mês: `monthly_targets` (cliente/subdivisão/formato/mês) ou, na ausência, a meta do cadastro.
- "Abaixo da meta": aprovados no mês < meta × (dia do mês / dias do mês).
- Aprovação na 1ª versão: conteúdos aprovados sem nenhuma reprovação / conteúdos aprovados.
- Tempo médio de aprovação: última aprovação − primeiro envio em lote.
- Sobrecarga: ≥ 3 tarefas atrasadas, ou ≥ 5 abertas e > 1,5× a média da equipe.
