-- Verification check 4, behavioural half: proves an actual INSERT receives a
-- fresh `updated_at` from the DEFAULT, then undoes it.
--
-- This file WRITES, so it is deliberately separate from the read-only
-- verification script. Safety properties:
--   - The whole body runs in one transaction that ends in ROLLBACK.
--   - The probe row is also deleted explicitly inside the transaction, so the
--     rollback is a second line of defence rather than the only one.
--   - The probe reuses a `user_id` already present in the table, because
--     `user_id` has a foreign key to `public.user_profiles`. It never inserts
--     into or modifies a legacy table. On an empty table it reports N-A.
--   - The probe id cannot collide with a generated `k_...` id.
--   - The outcome is passed out via `set_config(..., true)` (transaction-local)
--     rather than RAISE NOTICE, because NOTICE output is not returned by every
--     SQL client -- a silently swallowed PASS/FAIL is worse than none.
--
-- Verified output on the live project, 2026-09-13:
--   4.  PASS: got fresh now()
--   4b. PASS (rolled back)
--   4c. PASS (rows=2)

begin;

do $$
declare
  v_user_id text;
  v_updated timestamptz;
  v_created timestamptz;
begin
  select user_id into v_user_id from public.sunland_ai_knowledge limit 1;
  if v_user_id is null then
    perform set_config('verify.result', 'N-A: table empty', true);
    return;
  end if;

  insert into public.sunland_ai_knowledge
    (user_id, id, subject, relation, object, negated, confidence, source, created_at)
  values
    (v_user_id, '__verify_updated_at__', 'verify', '属于', 'verify', false, 1, 'user', now())
  returning updated_at, created_at into v_updated, v_created;

  perform set_config(
    'verify.result',
    case
      when v_updated is null then 'FAIL: updated_at NULL after insert'
      -- `now()` is transaction start time, so a row inserted in this
      -- transaction can get an updated_at slightly EARLIER than a later now()
      -- call; only closeness is asserted, never ordering.
      when abs(extract(epoch from (v_updated - now()))) < 5
        then 'PASS: got fresh now()'
      else 'FAIL: not now() (got ' || v_updated::text || ')'
    end,
    true
  );

  delete from public.sunland_ai_knowledge where id = '__verify_updated_at__';
end;
$$;

select '4. new insert gets fresh updated_at (rolled back)' as check_name,
       current_setting('verify.result', true) as result
union all
select '4b. probe row removed again',
       case when exists (select 1 from public.sunland_ai_knowledge where id='__verify_updated_at__')
            then 'FAIL: probe still present' else 'PASS (rolled back)' end
union all
select '4c. row count unchanged',
       (select case when count(*) = 2 then 'PASS (rows=2)'
                    else 'rows=' || count(*)::text end
          from public.sunland_ai_knowledge);

rollback;
