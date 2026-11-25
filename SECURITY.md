# Segurança e privacidade

## Camadas
1. **Banco (fronteira real):** RLS em todas as tabelas; FKs compostas por workspace; gatilhos que bloqueiam mudanças de status fora das RPCs; versões, respostas e logs append-only.
2. **Servidor:** Data Access Layer (`src/lib/auth.ts`) valida sessão (`getClaims`, assinatura do JWT) e workspace ativo apenas entre os que o usuário é membro ativo. Server Actions revalidam tudo; nada confia em IDs enviados pelo cliente.
3. **Interface:** esconde o que o usuário não pode fazer. É conveniência, não segurança.

## Permissões
Catálogo em `public.permissions`; funções (`roles`) por workspace, múltiplas por pessoa. `owner` tem tudo. Quem não tem `clients.view_all` só vê clientes em que está alocado (`client_members`) e conteúdos/tarefas atribuídos a si. Ninguém concede permissão que não possui (`save_role`). Só proprietários concedem/retiram "Proprietário"; o último proprietário não pode ser removido.

## Links de aprovação
- Token de 256 bits (`gen_random_bytes(32)`), armazenado **apenas como SHA-256**; exibido uma vez.
- Expiração obrigatória (padrão do workspace), revogação imediata (apaga sessões), rotação.
- PIN opcional (bcrypt); **obrigatório** para clientes marcados como sensíveis, com validade máx. 30 dias.
- 5 PINs errados ⇒ bloqueio de 15 min (contador persiste porque a função retorna em vez de lançar exceção).
- Sessão do portal: token aleatório de 12 h em cookie `httpOnly`/`Secure`, com path restrito ao link.
- `anon` não lê nenhuma tabela; só executa `portal_open/get/respond/bulk_approve/finalize`.
- Mídia: URLs assinadas de 1 h apenas para caminhos devolvidos pela RPC validada. Portal com `noindex`, `no-store`, `no-referrer` (indexação não é tratada como segurança).
- Rate limiting: servidor Next limita por hash de IP (`rate_limit_hit`). Chamadas diretas ao PostgREST são limitadas pela plataforma Supabase, pela entropia do token e pelo bloqueio de PIN.

## Google Drive
Escopo `drive.readonly` + identidade. Refresh token cifrado com AES-256-GCM (`DRIVE_TOKEN_ENCRYPTION_KEY`) em tabela sem políticas (só service role). OAuth com `state` vinculado a navegador e workspace. Nunca altera, move, exclui ou muda compartilhamento de arquivos.

## Armazenamento
Bucket privado `workspace-files`, caminho `<workspace>/<cliente>/<uuid>/<arquivo>`; políticas de `storage.objects` espelham o acesso ao cliente. Sem políticas de UPDATE/DELETE para usuários.

## Segredos
`SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET`, `DRIVE_TOKEN_ENCRYPTION_KEY`, `RESEND_API_KEY`, `CRON_SECRET` só no servidor. Nenhum segredo com prefixo `NEXT_PUBLIC_`. `.env*` no `.gitignore`.

## Cabeçalhos
HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. React escapa saída; nenhum `dangerouslySetInnerHTML` com dado de usuário (o único uso é o script fixo de tema). CSV exportado neutraliza fórmulas.

## Auditoria e LGPD
`audit_logs` (imutável): links criados/revogados/bloqueados, exceções de publicação, invalidações, funções, integrações. Retenção configurável em Configurações. A implementação técnica **não garante, sozinha, conformidade com a LGPD**: base legal, contratos com clientes (especialmente clínicas), DPA com Supabase/Vercel/Google e processo de atendimento a titulares precisam ser formalizados pela Delta.

## Pendências de segurança (ver IMPLEMENTATION_STATUS.md)
- CSP estrita com nonce.
- MFA para proprietários/administradores (Supabase Auth suporta; falta a UI).
- Job de retenção que remove arquivos vencidos.
- Backups: habilitar PITR no Supabase e testar restauração.
