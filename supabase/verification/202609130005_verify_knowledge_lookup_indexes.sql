-- Verification for the knowledge (user_id, relation) index + updated_at
-- migration (supabase/migrations/202609130005_add_knowledge_lookup_indexes.sql).
--
-- READ-ONLY. Safe to run before and after the migration, and safe to run twice.
-- Emits one row per required check with PASS / FAIL / N-A so the result can be
-- pasted back verbatim.
--
-- Check 4 ("new rows get a fresh updated_at") needs an INSERT, so its
-- behavioural half lives in:
--   supabase/verification/202609130005_verify_updated_at_default.sql

with columns as (
  select column_name, is_nullable, column_default, data_type
    from information_schema.columns
   where table_schema = 'public' and table_name = 'sunland_ai_knowledge'
),
indexes as (
  select i.relname as index_name,
         pg_get_indexdef(i.oid) as index_def,
         x.indisvalid, x.indisunique, x.indpred is not null as is_partial
    from pg_class i
    join pg_namespace n on n.oid = i.relnamespace
    join pg_index x on x.indexrelid = i.oid
   where n.nspname = 'public'
     and i.relname in (
       'sunland_ai_knowledge_pkey',
       'sunland_ai_knowledge_user_created_idx',
       'sunland_ai_knowledge_user_relation_idx',
       'sunland_ai_knowledge_user_id_subject_relation_object_negate_key'
     )
),
rls as (
  select relrowsecurity, relforcerowsecurity
    from pg_class where oid = 'public.sunland_ai_knowledge'::regclass
),
rpc as (
  select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'sunland_commit_turn',
       'sunland_import_legacy_state',
       'sunland_claim_activation_code'
     )
)
select '1a. (user_id, relation) index exists and is valid' as check_name,
       coalesce((select case
                   when not indisvalid then 'FAIL: index exists but is INVALID'
                   when is_unique then 'FAIL: index unexpectedly unique'
                   when is_partial then 'FAIL: index unexpectedly partial'
                   else 'PASS'
                 end
            from indexes where index_name = 'sunland_ai_knowledge_user_relation_idx'),
                'FAIL: index missing')
union all
select '1b. (user_id, relation) index has the expected columns',
       coalesce((select case
                   when pg_get_indexdef((select oid from pg_class
                                          where relname='sunland_ai_knowledge_user_relation_idx'
                                            and relnamespace='public'::regnamespace))
                        like '%(user_id, relation)%'
                   then 'PASS' else 'FAIL: ' ||
                        pg_get_indexdef((select oid from pg_class
                                          where relname='sunland_ai_knowledge_user_relation_idx'
                                            and relnamespace='public'::regnamespace))
                 end), 'N-A: index not created yet')
union all
select '1c. no redundant (user_id, subject) index was added',
       case when exists (select 1 from indexes where index_name = 'sunland_ai_knowledge_user_subject_idx')
            then 'FAIL: redundant index present, ruling #2 says it must not exist'
            else 'PASS (absent, as ruled)' end
union all
select '2a. updated_at is timestamptz',
       coalesce((select case when data_type = 'timestamp with time zone' then 'PASS'
                             else 'FAIL: ' || data_type end
            from columns where column_name = 'updated_at'), 'N-A: column not added yet')
union all
select '2b. updated_at is NOT NULL',
       coalesce((select case when is_nullable = 'NO' then 'PASS'
                             else 'FAIL: still nullable' end
            from columns where column_name = 'updated_at'), 'N-A: column not added yet')
union all
select '2c. updated_at default is now()',
       coalesce((select case when column_default like 'now()%' then 'PASS'
                             else 'FAIL: default is ' || coalesce(column_default, '<none>') end
            from columns where column_name = 'updated_at'), 'N-A: column not added yet')
union all
select '3. the 2 historical rows satisfy updated_at = created_at',
       case
         when not exists (select 1 from columns where column_name = 'updated_at')
           then 'N-A: column not added yet'
         else (select case when count(*) = 0
                           then 'PASS (all ' || (select count(*) from public.sunland_ai_knowledge)::text ||
                                ' rows: ' || count(*) filter (where updated_at = created_at)::text || ' equal)'
                           else 'FAIL: ' || count(*)::text || ' row(s) differ'
                      end
                 from public.sunland_ai_knowledge
                where updated_at is distinct from created_at)
       end
union all
select '4. new rows default to now() (column default; behavioural half is the other script)',
       case
         when not exists (select 1 from columns where column_name = 'updated_at')
           then 'N-A: column not added yet'
         when exists (select 1 from columns where column_name = 'updated_at' and column_default like 'now()%')
           then 'PASS (default) - run 202609130005_verify_updated_at_default.sql for the INSERT proof'
         else 'FAIL: default is ' || coalesce((select column_default from columns where column_name = 'updated_at'), '<none>')
       end
union all
select '5a. the 3 pre-existing indexes/constraints are unchanged',
       case when (select count(*) from indexes) = 4 then 'PASS (3 original + 1 new = 4 total)'
            else 'FAIL: expected 4 total, found ' || (select count(*) from indexes)::text
                 || ' [' || coalesce((select string_agg(index_name, ', ' order by index_name) from indexes), '<none>') || ']'
       end
union all
select '5b. primary key unchanged',
       case when exists (select 1 from indexes where index_name = 'sunland_ai_knowledge_pkey' and indisunique and indisvalid)
            then 'PASS' else 'FAIL: missing or altered' end
union all
select '5c. unique fact-identity constraint unchanged (columns and order)',
       case when exists (
              select 1
                from pg_constraint con
               cross join lateral (
                 select array_agg(att.attname::text order by k.ord) as names, count(*) as seen
                   from unnest(con.conkey) with ordinality as k(attnum, ord)
                   join pg_attribute att
                     on att.attrelid = con.conrelid
                    and att.attnum = k.attnum
               ) cols
               where con.conrelid = 'public.sunland_ai_knowledge'::regclass
                 and con.contype = 'u'
                 and cols.seen = 5
                 and cols.names = array['user_id','subject','relation','object','negated'])
            then 'PASS' else 'FAIL: not found or column order changed' end
union all
select '5d. pre-existing (user_id, created_at, id) index unchanged',
       case when exists (select 1 from indexes where index_name = 'sunland_ai_knowledge_user_created_idx' and indisvalid)
            then 'PASS' else 'FAIL: missing or invalid' end
union all
select '5e. RLS still enabled and forced',
       case when (select relrowsecurity and relforcerowsecurity from rls) then 'PASS'
            else 'FAIL: enabled=' || (select relrowsecurity::text from rls) ||
                 ' forced=' || (select relforcerowsecurity::text from rls) end
union all
select '5f. the three sunland_* RPCs of interest are present',
       -- Deliberately NOT a total count of sunland_* functions: the live project
       -- carries many more (33 as of 2026-09-13) that this migration must
       -- neither add to nor remove. Only these three are in scope.
       case when (select count(*) from rpc) = 3 then 'PASS (3/3 present)'
            else 'FAIL: found ' || (select count(*) from rpc)::text || ' of 3' end
union all
select '5g. sunland_commit_turn signature unchanged',
       case when exists (
              select 1 from rpc
               where proname = 'sunland_commit_turn'
                 and args = 'p_user_id text, p_conversation_id text, p_turn_id text, p_expected_revision bigint, p_request_hash text, p_knowledge jsonb, p_memory jsonb, p_context jsonb, p_response jsonb, p_expires_at timestamp with time zone')
            then 'PASS' else 'FAIL: ' || coalesce((select args from rpc where proname = 'sunland_commit_turn'), 'missing') end
union all
select '5h. sunland_import_legacy_state signature unchanged',
       case when exists (
              select 1 from rpc
               where proname = 'sunland_import_legacy_state'
                 and args = 'p_user_id text, p_migration_id text, p_payload_hash text, p_knowledge jsonb, p_memory jsonb, p_contexts jsonb')
            then 'PASS' else 'FAIL: ' || coalesce((select args from rpc where proname = 'sunland_import_legacy_state'), 'missing') end
union all
select '5i. sunland_claim_activation_code signature unchanged',
       case when exists (
              select 1 from rpc
               where proname = 'sunland_claim_activation_code'
                 and args = 'p_user_id text, p_code text')
            then 'PASS' else 'FAIL: ' || coalesce((select args from rpc where proname = 'sunland_claim_activation_code'), 'missing') end
union all
select '6a. knowledge row count (must stay 2)',
       (select 'rows=' || count(*)::text from public.sunland_ai_knowledge)
union all
select '6b. knowledge fact content unchanged',
       coalesce((select string_agg(subject || '|' || relation || '|' || object, ' ;; ' order by user_id, id)
                   from public.sunland_ai_knowledge), '<none>');
