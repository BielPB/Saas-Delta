create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), nullif(trim(new.raw_user_meta_data ->> 'name'), ''), 'Colaborador'),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Only replace untouched profiles that were initialized from the email address.
update public.profiles p
set full_name = 'Colaborador'
from auth.users u
where p.id = u.id
  and p.created_at = p.updated_at
  and p.full_name = split_part(u.email, '@', 1)
  and nullif(trim(u.raw_user_meta_data ->> 'full_name'), '') is null
  and nullif(trim(u.raw_user_meta_data ->> 'name'), '') is null;
