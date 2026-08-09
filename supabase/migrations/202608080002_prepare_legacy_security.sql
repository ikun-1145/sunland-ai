begin;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
alter function public.handle_new_user() set search_path = '';
alter function public.rls_auto_enable() set search_path = 'pg_catalog';

create or replace function public.increment_usage(uid text)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  insert into public.usage (user_id, count) values (uid, 1)
  on conflict (user_id) do update set count = public.usage.count + 1;
end;
$$;

create or replace function public.increment_usage(p_user uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  insert into public.usage (user_id, count) values (p_user::text, 1)
  on conflict (user_id) do update set count = public.usage.count + 1;
end;
$$;

-- Restrictive policies are installed now, while legacy table RLS state,
-- permissive policies and grants remain unchanged until the historically
-- signed forced-update release passes its gate. Enabling RLS here would lock
-- out old anonymous clients before they can upgrade.

drop policy if exists sunland_db_token_conversations on public.conversations;
create policy sunland_db_token_conversations on public.conversations as restrictive for all to authenticated
  using ((select auth.jwt()->>'id') = user_id) with check ((select auth.jwt()->>'id') = user_id);
drop policy if exists sunland_db_token_deleted_conversations on public.deleted_conversations;
create policy sunland_db_token_deleted_conversations on public.deleted_conversations as restrictive for all to authenticated
  using ((select auth.jwt()->>'id') = user_id) with check ((select auth.jwt()->>'id') = user_id);
drop policy if exists sunland_db_token_profiles on public.user_profiles;
create policy sunland_db_token_profiles on public.user_profiles as restrictive for all to authenticated
  using ((select auth.jwt()->>'id') = user_id) with check ((select auth.jwt()->>'id') = user_id);
drop policy if exists sunland_db_token_usage on public.usage;
create policy sunland_db_token_usage on public.usage as restrictive for select to authenticated
  using ((select auth.jwt()->>'id') = user_id);

-- The new short-lived authenticated token must not inherit the existing
-- whole-row profile write grant. Legacy clients use anon and remain unchanged
-- until the forced-upgrade gate.
revoke insert, update on table public.user_profiles from authenticated;
grant insert (user_id, avatar_url, avatar_path, name, updated_at) on table public.user_profiles to authenticated;
grant update (avatar_url, avatar_path, name, updated_at) on table public.user_profiles to authenticated;

commit;
