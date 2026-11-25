-- =============================================================================
-- DADOS DE DEMONSTRAÇÃO — SOMENTE AMBIENTE LOCAL (`supabase db reset`).
-- Nunca aplicar em produção. Cria uma conta demo@deltaflow.local / demo12345.
-- Clientes e conteúdos são fictícios e marcados com "[DEMO]".
-- =============================================================================
do $$
declare v_uid uuid := gen_random_uuid(); v_ws uuid; v_client uuid; v_format uuid; v_tpl uuid;
begin
  if exists (select 1 from auth.users where email = 'demo@deltaflow.local') then return; end if;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'demo@deltaflow.local',
          extensions.crypt('demo12345', extensions.gen_salt('bf')), now(), '{"full_name":"Gestora Demo"}', now(), now());
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  v_ws := public.create_workspace('[DEMO] Agência Delta', 'demo-delta');
  insert into public.clients (workspace_id, name, segment, monthly_target, created_by)
  values (v_ws, '[DEMO] Clínica Exemplo', 'Saúde e estética', 12, v_uid) returning id into v_client;
  insert into public.client_services (workspace_id, client_id, name, color, monthly_target) values
    (v_ws, v_client, 'Laser', '#C6FF34', 5), (v_ws, v_client, 'Institucional', '#3B82F6', 3);
  select id into v_format from public.content_formats where workspace_id = v_ws and key = 'reels';
  select id into v_tpl from public.content_templates where workspace_id = v_ws and name = 'Reels padrão';
  perform public.create_content(v_ws, v_client, v_format, '[DEMO] Reels antes e depois',
    jsonb_build_object('template_id', v_tpl, 'planned_publish_at', now() + interval '7 days'), '{}'::jsonb);
end $$;
