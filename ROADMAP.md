# Roadmap

## Antes do uso diário (curto prazo)
1. Staging com Supabase real + roteiro do IMPLEMENTATION_STATUS.md; E2E Playwright dos 12 cenários.
2. Envio de Web Push no worker (`web-push`, VAPID).
3. MFA para proprietários/administradores; CSP com nonce.
4. Job de retenção (arquivar finais após N meses, conforme Configurações).
5. Auditoria de acessibilidade (axe + leitor de tela) e medição do portal em 4G.

## Evolução do produto
- Entidade **Campanha** (agrupar conteúdos; lote "todos de uma campanha").
- Comentários com marcação de tempo no vídeo (estilo Frame.io) e anotações em imagem no portal.
- Sincronização agendada do Drive (Drive Changes API com `page_token` já previsto no schema).
- Exportação PDF/Excel dos relatórios.
- Tipos gerados do Supabase (`supabase gen types`).
- Migração opcional de mídia para Cloudflare R2 quando volume justificar (ver ARCHITECTURE.md).

## Fases futuras do briefing
Publicação automática (APIs oficiais da Meta) · WhatsApp Business API · apps nativos · financeiro, contratos, faturamento e planos (colunas `plan`/`limits` já existem e só a plataforma altera) · recursos de IA.
