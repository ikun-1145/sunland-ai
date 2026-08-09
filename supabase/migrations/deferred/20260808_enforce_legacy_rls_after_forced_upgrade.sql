-- RELEASE GATE: DO NOT APPLY until a historically signed Flutter APK has
-- shipped, update.json force=true is live, and old clients cannot bypass it.
begin;

-- Restrictive policies need a permissive policy to grant any row. During the
-- preparation phase they are intentionally ANDed with legacy permissive
-- policies; replace them at the release gate before dropping those policies.
drop policy if exists sunland_db_token_conversations on public.conversations;
create policy sunland_db_token_conversations on public.conversations as permissive for all to authenticated
  using ((select auth.jwt()->>'id') = user_id) with check ((select auth.jwt()->>'id') = user_id);
drop policy if exists sunland_db_token_deleted_conversations on public.deleted_conversations;
create policy sunland_db_token_deleted_conversations on public.deleted_conversations as permissive for all to authenticated
  using ((select auth.jwt()->>'id') = user_id) with check ((select auth.jwt()->>'id') = user_id);
drop policy if exists sunland_db_token_profiles on public.user_profiles;
create policy sunland_db_token_profiles on public.user_profiles as permissive for all to authenticated
  using ((select auth.jwt()->>'id') = user_id) with check ((select auth.jwt()->>'id') = user_id);
drop policy if exists sunland_db_token_usage on public.usage;
create policy sunland_db_token_usage on public.usage as permissive for select to authenticated
  using ((select auth.jwt()->>'id') = user_id);

alter table public.conversations enable row level security;
alter table public.conversations force row level security;
alter table public.deleted_conversations force row level security;
alter table public.user_profiles force row level security;
alter table public.usage enable row level security;
alter table public.usage force row level security;
alter table public.activation_codes enable row level security;
alter table public.activation_codes force row level security;
alter table public.messages enable row level security;
alter table public.messages force row level security;

revoke all on table public.activation_codes from public, anon, authenticated;
revoke all on table public.messages from public, anon, authenticated;
revoke all on table public.conversations from public, anon, authenticated;
revoke all on table public.deleted_conversations from public, anon, authenticated;
revoke all on table public.user_profiles from public, anon, authenticated;
revoke all on table public.usage from public, anon, authenticated;
grant select, insert, update, delete on table public.conversations to authenticated;
grant select, insert, update, delete on table public.deleted_conversations to authenticated;
grant select on table public.user_profiles to authenticated;
grant update (avatar_url, avatar_path, name, updated_at) on table public.user_profiles to authenticated;
grant select on table public.usage to authenticated;
revoke execute on function public.increment_usage(text) from public, anon, authenticated;
revoke execute on function public.increment_usage(uuid) from public, anon, authenticated;
grant execute on function public.increment_usage(text) to service_role;
grant execute on function public.increment_usage(uuid) to service_role;

do $$
declare policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('conversations', 'deleted_conversations', 'user_profiles', 'usage', 'activation_codes', 'messages')
      and policyname not like 'sunland_db_token_%'
  loop
    execute format('drop policy if exists %I on %I.%I', policy_record.policyname, policy_record.schemaname, policy_record.tablename);
  end loop;
end;
$$;

commit;
