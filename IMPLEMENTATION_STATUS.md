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
| Subdivisões com cor/meta/pasta; metas por cliente/subdivisão/formato/mês | 🟢 |
| Página do cliente com 9 abas; visão geral com primeiros passos, resumo do mês explicado, “Equipe agora” (tarefas por pessoa) e produção por subdivisão | 🟢 |
| Conteúdos: criação por template, 5 visualizações, filtros persistentes, ações em massa, duplicar, arquivar, cancelar | 🟢 |
| Pipeline com dependências, liberação automática e notificações | ✅ |
| Quadro do pipeline em 5 colunas (Roteiro, Gravação, Edição, Finalização, Pronto) agrupando as 12 etapas; cards com entregáveis e responsável; menu Projetos (cliente → subdivisões) | 🟢 |
| Tarefas: minhas, central, detalhe, checklist, comentários, reabrir/cancelar | ✅ banco · 🟢 UI |
| Dashboard executivo, atenção prioritária, filtros, indicadores clicáveis | ✅ banco · 🟢 UI |
| Onboarding (workspace + checklist de 10 passos que pode ser pulado) | 🟢 |

## Fase 3 — Arquivos e integrações
| Item | Status |
|---|---|
| Upload TUS direto (retomar, pausar, cancelar, progresso, duplicidade, validação) | 🟢 (Storage real necessário para testar retomada) |
| Biblioteca e central de não vinculados com sugestões (nunca automáticas) | ✅ sugestão no banco · 🟢 UI |
| Google Drive: OAuth, pastas → cliente/subdivisão, sincronização, novos/indisponíveis, sem duplicar | 🟢 🔑 |
| Preview audiovisual (proporção preservada, carrossel, tela cheia, versões) | 🟢 |
| Worker de preview (Drive/Storage → H.264 720p + poster) | ✅ transcodificação · 🟢 fila · 🔑 |
| Versionamento imutável | ✅ |

## Fase 4 — Aprovação
| Item | Status |
|---|---|
| Lotes (único, vários, por subdivisão, semanal, mensal), link seguro, PIN, expiração, revogação, rotação | ✅ |
| Portal: um conteúdo por vez com seletor numerado; “Aprovado / Não aprovado” por conteúdo, marcando quais itens precisam de ajuste (os não marcados são aprovados); observação obrigatória na reprovação; respostas salvas ao avançar; resumo final | ✅ banco · 🟢 UI (ainda não testada com dados reais) |
| Ajuste automático só para o entregável reprovado; invalidação explícita | ✅ |
| "Todos os conteúdos de uma campanha" | ⏳ não há entidade Campanha na v1; use subdivisão/período |

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

## Interface v2 (redesenho)
| Item | Status |
|---|---|
| Menu: atalhos, clientes por categoria (só categorias com clientes), “Mais” recolhido; botão Voltar | 🟢 |
| Cliente: foto/logo, seletor de mês, Posts/Reels/Stories em grade, painel lateral do post, onboarding, ficha, duplicar mês, baixar em alta qualidade (ZIP no navegador) | 🟢 |
| Status do post = coluna do pipeline; arrastar no quadro; soltar em Pronto libera ao cliente | 🟢 |
| Tarefas ligadas a posts, com etapa que avança o post ao concluir | 🟢 |
| Aprovação em Preview de feed (ordem por data ou personalizada), link do mês, PIN automático, aprovação por imagem | 🟢 |
| Minhas demandas, Dashboard da meta, Calendário com miniaturas, ranking por meta individual | 🟢 |
| Google Agenda por pessoa (leitura em Minhas demandas + eventos de prazos/publicações) | 🟢 testado com 1 conta |
| Vídeos por link do Google Drive (player no portal) | 🟢 |
| Celular: campos com 16px (sem zoom no iPhone), alvos de toque maiores (`pointer-coarse:`), janelas como folha inferior, área segura do iPhone (app instalado), filtros recolhidos, Pipeline com “Mover” por toque, Calendário em miniaturas, Preview do feed com setas, portal do cliente sem estouro | 🟢 build ok · ⏳ conferir em aparelho real |
| Resposta imediata: filtros de Minhas demandas no navegador; abas e botões que vão ao servidor marcam o clique na hora (`ToggleLink`); cache do navegador de 30 s (`staleTimes`); menus “…” flutuam por cima de tabelas | 🟢 |
| Equipe: “Gerar acesso” para convidados (senha provisória enviada pelo WhatsApp, enquanto não há e-mail) | 🟢 |
| Recuperar senha: o link funciona em qualquer aparelho/navegador (pedido sem PKCE); erros de nova senha explicados (igual à atual, fraca, sessão expirada) | 🟢 ⏳ conferir com e-mail real |
| Menu de clientes: renomear categoria (menu … no título da categoria; “Sem categoria” não é uma pasta real) | 🟢 |
| “Link dos vídeos” (abas de vídeo do cliente) e lista de vídeos no portal (todos na mesma tela, aprovar/pedir ajuste embaixo de cada um; miniatura primeiro, player só no toque) | 🟢 ⏳ conferir no celular com link real |
| Portal no iPhone: vídeos do Drive tocam no player nativo do aparelho (arquivo direto do Drive; o player embutido do Drive cortava vídeo em pé e punha os controles no meio). Se o aparelho não conseguir tocar, volta sozinho para o player do Drive. Capa recortada como no perfil e centralizada | 🟢 ⏳ conferir no iPhone |
| “Vários vídeos por link” (abas de vídeo do cliente): cola o link de uma pasta do Drive (ou vários links), escolhe a subdivisão de cada vídeo e cria um post por vídeo com o link já anexado. Lê a pasta pública sem chave; se não for pública, usa a conta do Drive conectada em Integrações | 🟢 ⏳ conferir com pasta real |
| E-mail (Resend) | ⏳ depende de domínio próprio |
| Métricas de redes sociais, IA, financeiro | ⏳ fora do escopo atual |

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
