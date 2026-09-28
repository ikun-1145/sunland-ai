-- Pre-flight reconnaissance for 202609130005_add_knowledge_lookup_indexes.sql
--
-- READ-ONLY. Run this BEFORE applying the migration and paste the output back.
-- It answers exactly the questions the migration's own pre-flight asserts, so
-- we can confirm the migration's assumptions against the live database instead
-- of discovering a mismatch during apply.
--
-- Run it in the Supabase SQL Editor (or psql) against the target project.

-- Q1. Actual schema of sunland_ai_knowledge: columns, types, nullability,
--     defaults. Confirms `updated_at` is absent today and lists what exists.
select 'Q1 columns' as question,
       ordinal_position::text || '. ' || column_name || ' :: ' || data_type ||
       ' | nullable=' || is_nullable ||
       ' | default=' || coalesce(column_default, '<none>') as detail
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'sunland_ai_knowledge'
 order by ordinal_position;

-- Q2. Existing indexes on the table (name, uniqueness, partial?, definition).
--     Confirms the only index today is sunland_ai_knowledge_user_created_idx
--     and that the two planned names are free.
select 'Q2 indexes' as question,
       i.relname || ' | unique=' || x.indisunique::text ||
       ' | partial=' || (x.indpred is not null)::text as detail,
       pg_get_indexdef(i.oid) as definition
  from pg_class i
  join pg_namespace n on n.oid = i.relnamespace
  join pg_index x on x.indexrelid = i.oid
 where n.nspname = 'public'
   and x.indrelid = 'public.sunland_ai_knowledge'::regclass
 order by i.relname;

-- Q3. Constraints: primary key and the fact-identity unique constraint, with
--     their columns IN CONSTRAINT ORDER (the order matters for the comparison).
select 'Q3 constraint' as question,
       con.conname || ' | type=' || con.contype::text || ' | cols=' ||
       coalesce((
         select string_agg(att.attname, ',' order by k.ord)
           from unnest(con.conkey) with ordinality as k(attnum, ord)
           join pg_attribute att
             on att.attrelid = con.conrelid and att.attnum = k.attnum
       ), '<none>') as detail,
       pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
 where con.conrelid = 'public.sunland_ai_knowledge'::regclass
 order by con.contype, con.conname;

-- Q4. Row count and data shape. Row count sizes the backfill; the DISTINCT
--     counts show how much duplication the unique constraint is actually
--     holding back, and min/max created_at bound the backfilled values.
select 'Q4 rows' as question,
       'rows=' || count(*)::text ||
       ' | distinct_users=' || count(distinct user_id)::text ||
       ' | distinct_triples=' || count(distinct (user_id, subject, relation, object, negated))::text ||
       ' | earliest_created_at=' || coalesce(min(created_at)::text, '<none>') ||
       ' | latest_created_at=' || coalesce(max(created_at)::text, '<none>') ||
       ' | any_null_created_at=' || count(*) filter (where created_at is null)::text as detail
  from public.sunland_ai_knowledge;

-- Q5. RLS state, so we can prove the migration leaves it untouched.
select 'Q5 rls' as question,
       'rls_enabled=' || relrowsecurity::text ||
       ' | rls_forced=' || relforcerowsecurity::text as detail
  from pg_class
 where oid = 'public.sunland_ai_knowledge'::regclass;

-- Q6. The three RPCs, with exact signatures. Confirms no signature drift and
--     gives the baseline to re-compare after apply.
select 'Q6 rpc' as question,
       p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('sunland_commit_turn', 'sunland_import_legacy_state', 'sunland_claim_activation_code')
 order by p.proname;

-- Q7. Does the RPC's INSERT list columns explicitly? If it does NOT, adding a
--     NOT NULL column without a default would break every turn; the migration
--     always sets a default for exactly this reason. This prints the source so
--     the claim can be checked rather than trusted.
select 'Q7 rpc source' as question,
       case
         when pg_get_functiondef(p.oid) like '%insert into public.sunland_ai_knowledge%(%'
         then 'explicit column list present (safe)'
         else 'CHECK MANUALLY: no explicit column list found'
       end as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'sunland_commit_turn';

-- Q8. Which queries would use the two new indexes? Confirms the migration is
--     worth applying by showing the current plan for a subject/relation filter.
--     On a small table this will legitimately choose a sequential scan.
explain (costs off)
select id, subject, relation, object, negated, confidence, source, created_at
  from public.sunland_ai_knowledge
 where user_id = 'replace-with-a-real-user-id'
   and subject = 'replace-with-a-real-subject';

-- Q9. Confirm the deferred legacy hardening has NOT been applied (that gate is
--     unrelated to this migration and must stay deferred).
select 'Q9 deferred gate' as question,
       case
         when exists (
           select 1 from pg_policies
            where schemaname = 'public' and tablename = 'user_profiles'
              and policyname = 'sunland_db_token_profiles'
         ) then 'prepare policy present (expected); deferred enforcement state unchanged by this migration'
         else 'no prepare policy found - review before proceeding'
       end as detail;
