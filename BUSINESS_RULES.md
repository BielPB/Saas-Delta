# Regras de negócio e máquina de estados

Fonte da verdade: `supabase/migrations/20261124000005_workflow.sql` (`private.recompute_content`).
Nenhuma coluna de status é gravada diretamente: o gatilho `guard_*` rejeita UPDATE fora das RPCs.

## Entidades
- **Conteúdo** é a entidade central. Tem **entregáveis** (roteiro, material bruto, vídeo, capa, legenda, arte, carrossel).
- Cada entregável tem **versões imutáveis** (V1, V2…). Uma versão nunca é sobrescrita nem apagada.
- **Tarefas** produzem entregáveis e podem depender de outras tarefas (DAG, ciclos rejeitados).
- **Entregável interno**: roteiro e material bruto (nunca vão ao cliente). **Voltado ao cliente**: vídeo, capa, legenda, arte, carrossel.

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
- Meta do mês: `monthly_targets` (cliente/serviço/formato/mês) ou, na ausência, a meta do cadastro.
- "Abaixo da meta": aprovados no mês < meta × (dia do mês / dias do mês).
- Aprovação na 1ª versão: conteúdos aprovados sem nenhuma reprovação / conteúdos aprovados.
- Tempo médio de aprovação: última aprovação − primeiro envio em lote.
- Sobrecarga: ≥ 3 tarefas atrasadas, ou ≥ 5 abertas e > 1,5× a média da equipe.
