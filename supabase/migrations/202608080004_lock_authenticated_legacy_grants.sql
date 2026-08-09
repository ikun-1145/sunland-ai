begin;

-- Legacy releases use the anon role. The new web and Flutter releases use a
-- short-lived authenticated token, so give that role only its intended API
-- surface while leaving anon compatibility unchanged until the release gate.
revoke all on table public.conversations from authenticated;
revoke all on table public.deleted_conversations from authenticated;
revoke all on table public.user_profiles from authenticated;
revoke all on table public.usage from authenticated;
revoke all on table public.activation_codes from authenticated;
revoke all on table public.messages from authenticated;

grant select, insert, update, delete on table public.conversations to authenticated;
grant select, insert, update, delete on table public.deleted_conversations to authenticated;
grant select on table public.user_profiles to authenticated;
grant update (avatar_url, avatar_path, name, updated_at) on table public.user_profiles to authenticated;
grant select on table public.usage to authenticated;

commit;
