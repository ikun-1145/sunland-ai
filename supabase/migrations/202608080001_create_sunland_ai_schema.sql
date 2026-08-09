begin;

create table if not exists public.sunland_ai_user_state (
  user_id text primary key references public.user_profiles(user_id) on delete cascade,
  schema_version integer not null default 1 check (schema_version between 1 and 1000),
  revision bigint not null default 0 check (revision >= 0),
  migration_status text not null default 'pending' check (migration_status in ('pending', 'complete')),
  updated_at timestamptz not null default now()
);

create table if not exists public.sunland_ai_knowledge (
  user_id text not null references public.user_profiles(user_id) on delete cascade,
  id text not null check (char_length(id) between 1 and 128),
  subject text not null check (char_length(subject) between 1 and 256),
  relation text not null check (char_length(relation) between 1 and 128),
  object text not null check (char_length(object) between 1 and 512),
  negated boolean not null default false,
  confidence double precision not null default 1 check (confidence between 0 and 1),
  source text not null check (source in ('user', 'inference', 'seed', 'import')),
  created_at timestamptz not null,
  primary key (user_id, id),
  unique (user_id, subject, relation, object, negated)
);

create table if not exists public.sunland_ai_memory (
  user_id text not null references public.user_profiles(user_id) on delete cascade,
  key text not null check (char_length(key) between 1 and 64),
  id text not null check (char_length(id) between 1 and 128),
  value text not null check (char_length(value) between 1 and 1024),
  created_at timestamptz not null,
  updated_at timestamptz not null check (updated_at >= created_at),
  primary key (user_id, key)
);

create table if not exists public.sunland_ai_context (
  user_id text not null references public.user_profiles(user_id) on delete cascade,
  conversation_id text not null check (char_length(conversation_id) between 1 and 128),
  version integer not null default 0 check (version >= 0),
  context jsonb not null check (jsonb_typeof(context) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

create table if not exists public.sunland_ai_turn_results (
  user_id text not null references public.user_profiles(user_id) on delete cascade,
  turn_id text not null check (char_length(turn_id) between 1 and 128),
  conversation_id text not null check (char_length(conversation_id) between 1 and 128),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  state_revision bigint not null check (state_revision >= 1),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at),
  primary key (user_id, turn_id)
);

create table if not exists public.sunland_ai_migration_receipts (
  user_id text not null references public.user_profiles(user_id) on delete cascade,
  migration_id text not null check (char_length(migration_id) between 1 and 128),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (user_id, migration_id)
);

create index if not exists sunland_ai_knowledge_user_created_idx on public.sunland_ai_knowledge (user_id, created_at, id);
create index if not exists sunland_ai_memory_user_updated_idx on public.sunland_ai_memory (user_id, updated_at desc);
create index if not exists sunland_ai_context_user_updated_idx on public.sunland_ai_context (user_id, updated_at desc);
create index if not exists sunland_ai_turn_results_user_expiry_idx on public.sunland_ai_turn_results (user_id, expires_at);
create index if not exists sunland_ai_migration_receipts_user_created_idx on public.sunland_ai_migration_receipts (user_id, created_at desc);

alter table public.sunland_ai_user_state enable row level security;
alter table public.sunland_ai_user_state force row level security;
alter table public.sunland_ai_knowledge enable row level security;
alter table public.sunland_ai_knowledge force row level security;
alter table public.sunland_ai_memory enable row level security;
alter table public.sunland_ai_memory force row level security;
alter table public.sunland_ai_context enable row level security;
alter table public.sunland_ai_context force row level security;
alter table public.sunland_ai_turn_results enable row level security;
alter table public.sunland_ai_turn_results force row level security;
alter table public.sunland_ai_migration_receipts enable row level security;
alter table public.sunland_ai_migration_receipts force row level security;

revoke all on table public.sunland_ai_user_state from public, anon, authenticated;
revoke all on table public.sunland_ai_knowledge from public, anon, authenticated;
revoke all on table public.sunland_ai_memory from public, anon, authenticated;
revoke all on table public.sunland_ai_context from public, anon, authenticated;
revoke all on table public.sunland_ai_turn_results from public, anon, authenticated;
revoke all on table public.sunland_ai_migration_receipts from public, anon, authenticated;
grant select, insert, update, delete on table public.sunland_ai_user_state to service_role;
grant select, insert, update, delete on table public.sunland_ai_knowledge to service_role;
grant select, insert, update, delete on table public.sunland_ai_memory to service_role;
grant select, insert, update, delete on table public.sunland_ai_context to service_role;
grant select, insert, update, delete on table public.sunland_ai_turn_results to service_role;
grant select, insert, update, delete on table public.sunland_ai_migration_receipts to service_role;

create or replace function public.sunland_commit_turn(
  p_user_id text, p_conversation_id text, p_turn_id text, p_expected_revision bigint,
  p_request_hash text, p_knowledge jsonb, p_memory jsonb, p_context jsonb,
  p_response jsonb, p_expires_at timestamptz
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_revision bigint;
  v_existing_hash text;
  v_existing_response jsonb;
  v_next_revision bigint;
  v_response jsonb;
  v_record jsonb;
begin
  if jsonb_typeof(p_knowledge) <> 'array' or jsonb_typeof(p_memory) <> 'array'
    or jsonb_typeof(p_context) <> 'object' or jsonb_typeof(p_response) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_turn_payload';
  end if;

  select request_hash, response into v_existing_hash, v_existing_response
    from public.sunland_ai_turn_results where user_id = p_user_id and turn_id = p_turn_id;
  if found then
    if v_existing_hash <> p_request_hash then
      raise exception using errcode = '23505', message = 'turn_id_reused';
    end if;
    return v_existing_response;
  end if;

  insert into public.sunland_ai_user_state (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select revision into v_revision from public.sunland_ai_user_state where user_id = p_user_id for update;
  if v_revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'revision_conflict';
  end if;

  for v_record in select value from jsonb_array_elements(p_knowledge) loop
    insert into public.sunland_ai_knowledge (user_id, id, subject, relation, object, negated, confidence, source, created_at)
    values (p_user_id, v_record->>'id', v_record->>'subject', v_record->>'relation', v_record->>'object',
      (v_record->>'negated')::boolean, (v_record->>'confidence')::double precision,
      v_record->>'source', (v_record->>'createdAt')::timestamptz)
    on conflict do nothing;
  end loop;

  for v_record in select value from jsonb_array_elements(p_memory) loop
    insert into public.sunland_ai_memory (user_id, key, id, value, created_at, updated_at)
    values (p_user_id, v_record->>'key', v_record->>'id', v_record->>'value',
      (v_record->>'createdAt')::timestamptz, (v_record->>'updatedAt')::timestamptz)
    on conflict (user_id, key) do update set id = excluded.id, value = excluded.value,
      created_at = excluded.created_at, updated_at = excluded.updated_at;
  end loop;

  insert into public.sunland_ai_context (user_id, conversation_id, version, context, updated_at)
  values (p_user_id, p_conversation_id, coalesce((p_context->>'version')::integer, 0), p_context, now())
  on conflict (user_id, conversation_id) do update set version = excluded.version,
    context = excluded.context, updated_at = excluded.updated_at;

  v_next_revision := v_revision + 1;
  v_response := jsonb_set(p_response, '{stateRevision}', to_jsonb(v_next_revision), true);
  update public.sunland_ai_user_state set revision = v_next_revision, updated_at = now() where user_id = p_user_id;
  insert into public.sunland_ai_turn_results
    (user_id, turn_id, conversation_id, request_hash, response, state_revision, expires_at)
  values (p_user_id, p_turn_id, p_conversation_id, p_request_hash, v_response, v_next_revision, p_expires_at);
  return v_response;
end;
$$;

create or replace function public.sunland_import_legacy_state(
  p_user_id text, p_migration_id text, p_payload_hash text,
  p_knowledge jsonb, p_memory jsonb, p_contexts jsonb
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_existing_hash text;
  v_existing_result jsonb;
  v_revision bigint;
  v_record jsonb;
  v_context jsonb;
  v_result jsonb;
begin
  if jsonb_typeof(p_knowledge) <> 'array' or jsonb_typeof(p_memory) <> 'array'
    or jsonb_typeof(p_contexts) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid_migration_payload';
  end if;
  select payload_hash, result into v_existing_hash, v_existing_result
    from public.sunland_ai_migration_receipts where user_id = p_user_id and migration_id = p_migration_id;
  if found then
    if v_existing_hash <> p_payload_hash then
      raise exception using errcode = '23505', message = 'migration_id_reused';
    end if;
    return v_existing_result;
  end if;

  insert into public.sunland_ai_user_state (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select revision into v_revision from public.sunland_ai_user_state where user_id = p_user_id for update;

  for v_record in select value from jsonb_array_elements(p_knowledge) loop
    insert into public.sunland_ai_knowledge (user_id, id, subject, relation, object, negated, confidence, source, created_at)
    values (p_user_id, v_record->>'id', v_record->>'subject', v_record->>'relation', v_record->>'object',
      (v_record->>'negated')::boolean, (v_record->>'confidence')::double precision,
      'import', (v_record->>'createdAt')::timestamptz)
    on conflict do nothing;
  end loop;

  for v_record in select value from jsonb_array_elements(p_memory) loop
    insert into public.sunland_ai_memory (user_id, key, id, value, created_at, updated_at)
    values (p_user_id, v_record->>'key', v_record->>'id', v_record->>'value',
      (v_record->>'createdAt')::timestamptz, (v_record->>'updatedAt')::timestamptz)
    on conflict (user_id, key) do update set id = excluded.id, value = excluded.value,
      created_at = least(public.sunland_ai_memory.created_at, excluded.created_at), updated_at = excluded.updated_at
    where excluded.updated_at > public.sunland_ai_memory.updated_at;
  end loop;

  for v_context in select value from jsonb_array_elements(p_contexts) loop
    if jsonb_typeof(v_context->'context') <> 'object'
      or coalesce((v_context->'context'->>'version')::integer, -1) < 0 then
      raise exception using errcode = '22023', message = 'invalid_context_payload';
    end if;
    insert into public.sunland_ai_context (user_id, conversation_id, version, context, updated_at)
    values (p_user_id, v_context->>'conversationId', (v_context->'context'->>'version')::integer,
      v_context->'context', now())
    on conflict (user_id, conversation_id) do update set version = excluded.version,
      context = excluded.context, updated_at = excluded.updated_at
    where excluded.version > public.sunland_ai_context.version;
  end loop;

  v_revision := v_revision + 1;
  update public.sunland_ai_user_state set revision = v_revision, migration_status = 'complete', updated_at = now()
    where user_id = p_user_id;
  v_result := jsonb_build_object('migrationId', p_migration_id, 'payloadHash', p_payload_hash,
    'status', 'complete', 'stateRevision', v_revision);
  insert into public.sunland_ai_migration_receipts (user_id, migration_id, payload_hash, result)
    values (p_user_id, p_migration_id, p_payload_hash, v_result);
  return v_result;
end;
$$;

create or replace function public.sunland_claim_activation_code(p_user_id text, p_code text)
returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  v_used_by text;
  v_profile_pro boolean;
begin
  select pro into v_profile_pro from public.user_profiles where user_id = p_user_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'unknown_user';
  end if;
  if v_profile_pro is true or exists (
    select 1 from public.activation_codes where used_by = p_user_id
  ) then
    return 'already_activated';
  end if;

  select used_by into v_used_by from public.activation_codes where code = p_code for update;
  if not found then return 'invalid_code'; end if;
  if v_used_by is not null then
    return case when v_used_by = p_user_id then 'already_activated' else 'used_by_other' end;
  end if;

  update public.activation_codes set used_by = p_user_id, used_at = now() where code = p_code;
  update public.user_profiles set pro = true, updated_at = now() where user_id = p_user_id;
  return 'success';
end;
$$;

revoke all on function public.sunland_commit_turn(text, text, text, bigint, text, jsonb, jsonb, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.sunland_import_legacy_state(text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sunland_commit_turn(text, text, text, bigint, text, jsonb, jsonb, jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.sunland_import_legacy_state(text, text, text, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.sunland_claim_activation_code(text, text) from public, anon, authenticated;
grant execute on function public.sunland_claim_activation_code(text, text) to service_role;

commit;
