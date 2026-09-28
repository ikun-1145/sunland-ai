-- Rollback for the knowledge (user_id, relation) index + updated_at migration
-- (supabase/migrations/202609130005_add_knowledge_lookup_indexes.sql).
--
-- This file is deliberately NOT under supabase/migrations/: a migration runner
-- must never treat a rollback as a forward migration.
--
-- Reverses exactly what the migration added, and nothing else:
--   - drops the (user_id, relation) lookup index
--   - drops `updated_at` (and its backfilled values -- they are derivable from
--     `created_at`, so no unique information is lost)
--
-- It does NOT touch any RPC, RLS, policy, grant, or legacy table, and it does
-- not attempt to undo anything the migration did not create.
--
-- Safety properties: re-runnable (every statement is guarded), and it refuses
-- to drop `updated_at` if a future change started depending on real write times
-- that differ from `created_at` -- dropping the column would then silently
-- destroy information. Remove that guard deliberately, not by accident.

begin;

do $$
begin
  if to_regclass('public.sunland_ai_knowledge') is null then
    raise notice 'rollback skipped: public.sunland_ai_knowledge does not exist';
    return;
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'sunland_ai_knowledge'
       and column_name = 'updated_at'
  ) and exists (
    select 1
      from public.sunland_ai_knowledge
     where updated_at is distinct from created_at
     limit 1
  ) then
    raise exception
      'rollback refused: updated_at carries write times beyond the initial backfill; dropping it would lose information';
  end if;
end;
$$;

drop index if exists public.sunland_ai_knowledge_user_relation_idx;

alter table public.sunland_ai_knowledge
  drop column if exists updated_at;

commit;
