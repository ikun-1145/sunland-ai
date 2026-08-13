# Sunland AI project memory

> Audience: maintainers and coding agents. Last verified against the repository on 2026-08-12. Update this document when a stable architectural fact changes; do not use it as a task log.

## Product identity

Sunland AI is a deterministic symbolic conversational engine with structured, explainable state. It is not an LLM wrapper. The Core understands a bounded set of conversational, semantic, knowledge, memory, community-language, and dialogue patterns, then produces a response through explicit planners and personality renderers.

The repository is a private npm-workspaces monorepo at version `0.1.0`. The packages are not published for third-party consumption.

## Current system shape

```text
Authenticated client
  -> Cloudflare Worker (`apps/api`)
  -> HS256 JWT verification and CORS allowlist
  -> one Durable Object per verified JWT `id`
  -> `@sunland-ai/core` engine execution
  -> Supabase REST/RPC transaction
```

Production clients call the HTTP API. They do not load a JavaScript Core bundle and must not duplicate parser, semantic, reasoning, memory, or personality decisions.

The Durable Object exists to serialize a user's operations and hold the one-minute rate-limit window. Durable Knowledge, Memory, Context, revision state, migration receipts, and idempotent turn results live in Supabase.

## Workspace responsibilities

### `packages/core`

- Public source boundary: `packages/core/src/sdk.ts` and package import `@sunland-ai/core`.
- Composition root: `packages/core/src/engine/sunlandEngine.ts`.
- Major layers: parser and semantic producers, unified Turn Understanding, community language/pragmatics, dialogue tracking, Knowledge, Memory, graph reasoning, response planning, observation summaries, and personality.
- Default personality: Frost; Plain is also registered.
- No network, authentication, Supabase, Cloudflare, React, or DOM dependencies.
- Public runtime surface is frozen by `contracts/sdk-api-surface.v0.1.0.json` at 70 exports for Core `0.1.0`.

### Core turn-understanding path

```text
Raw input + conversation state
  -> existing Parser, Semantic, Dialogue, Community, Pragmatics, Social, and Topic producers
  -> TurnUnderstanding candidate pool
  -> deterministic Understanding Resolver
  -> TurnUnderstanding
  -> existing Dialogue Planner
  -> persona-neutral ResponseAct inside DialoguePlan
  -> Frost or Plain renderer
```

`TurnUnderstanding` is the only input accepted by Dialogue Planner, conversation-state advancement, and Initiative planning. Existing producer outputs and Stage 15 state are retained behind one-way compatibility adapters during gradual migration; these migrated planning modules must not independently reclassify the raw input. The Core process result exposes the resolved understanding for evaluation and host diagnostics, but `apps/api` deliberately omits it and raw input is not part of persisted conversation state.

### `apps/api`

- `handler.ts`: health check, CORS, JWT authentication, Durable Object routing, and daily expiry cleanup.
- `userBrain.ts`: authenticated routes, 60-request-per-minute per-user limiter, idempotency, one retry after a revision conflict, and state deletion endpoints.
- `coreSession.ts`: rebuilds an engine from a Supabase snapshot, runs passive semantic mode with Context enabled, and returns the next state.
- `supabaseRepository.ts`: REST reads/deletes and transactional RPC commits/imports.
- `validation.ts`: bounds turn and legacy migration inputs before state changes.

### `apps/playground`

The Playground is a multilingual Vite/React visual scaffold with four placeholder panels. It is not connected to `apps/api`, does not visualize live reasoning, and is not a production client. Do not present planned panels as implemented features.

### `supabase/migrations`

The schema depends on existing Sunland tables such as `user_profiles`. The closed `sunland_ai_*` tables use service-role access and include user revision state, Knowledge, Memory, per-conversation Context, seven-day turn results, and migration receipts.

The file under `supabase/migrations/deferred/` is deliberately outside the normal release path. It changes legacy-table RLS and grants only after a historically signed forced-upgrade client passes the deployment gate.

## Durable state model

| State | Scope | Durable owner | Purpose |
|---|---|---|---|
| Knowledge | verified user | Supabase | user-taught structured facts |
| Memory | verified user | Supabase | bounded facts about the user, currently including name |
| Semantic Context | verified user + conversation | Supabase | minimal cross-turn references and topic continuity |
| User revision | verified user | Supabase | optimistic concurrency token |
| Turn result | verified user + `turnId` | Supabase, seven days | idempotent response replay |
| Rate window | verified user | Durable Object storage | 60 requests per one-minute counting window |

Chat transcripts and account identity are not Core state.

## HTTP contract summary

- Public: `GET /healthz`.
- Authenticated: `POST /v1/turns`, `POST /v1/migrations/local-state`, `GET /v1/knowledge`, Knowledge deletion, name-memory deletion, and conversation-Context deletion.
- All authenticated routes derive the user from the verified JWT. The API strips the authorization header before forwarding internally and injects the verified ID.
- A turn accepts `conversationId`, `turnId`, `input`, and optional `observationMode` (`off` or `summary`).
- Identical `turnId` + request payloads replay the stored response. A different payload under the same `turnId` returns a conflict.
- The commit RPC updates Knowledge, Memory, Context, revision, and the turn result atomically. Persistence failure is a failed request, never a successful response.

See [`api.md`](api.md) for request examples and limits.

## Security and operational invariants

- Preferred JWT secrets are primary + legacy during rotation; `APP_JWT_SECRET` is a compatibility alias only.
- Preferred Supabase configuration is `SUPABASE_PROJECT_URL` + `SUPABASE_SECRET_KEY`; URL and service-role aliases are temporary migration compatibility.
- Modern `sb_secret_...` keys are sent only in the `apikey` header. Legacy JWT service-role keys also use `Authorization: Bearer`.
- CORS applies an explicit origin allowlist. Requests with an unapproved `Origin` are rejected.
- Restored Context and legacy state are untrusted and must pass normalization/validation.
- Observation summaries contain only whitelisted, bucketed diagnostics and no raw input or identity.
- Core writes must pass the existing side-effect safety gates. Clients and API adapters cannot synthesize writes from keywords.

## Known limitations and historical context

- The Playground UI still labels itself as a Stage 1 scaffold.
- There is no published SDK bundle or automated release-bundle pipeline in the current repository.
- There is no root lint script.
- `packages/core/docs/beta-launch-audit-v0.1.0.md` and `beta-test-checklist.md` describe an earlier Web/Flutter local-Bundle integration and are retained only as historical evidence.
- Some source comments still mention the earlier local Provider or bundle shape. Current runtime imports and tests take precedence.
- The legacy-table RLS hardening gate remains intentionally deferred; preparation migrations must not be described as complete isolation for those legacy tables.
- Unified Turn Understanding is an MVP integration layer: existing component outputs and compatibility labels remain while producers are migrated toward smaller atomic candidates. Context stores have not been consolidated.

## Stable engineering decisions

1. One symbolic Core: business decisions live in `packages/core`, with `sunlandEngine.ts` as the composition root.
2. Server ownership: clients call the Worker and never execute or fork the Core.
3. Verified identity ownership: API identity always comes from the signed JWT, never request data.
4. Explicit state separation: Knowledge, user Memory, conversation Context, transcript, and identity are different concerns.
5. Atomic turns: state changes and replayable turn results commit together under optimistic concurrency.
6. Safe semantics: understanding candidates can propose interpretation but cannot bypass write safety.
7. Historical migration safety: legacy RLS enforcement waits for the signed forced-upgrade gate.
8. One resolved turn bus: existing understanding modules contribute evidence to `TurnUnderstanding`; Dialogue and Initiative consume that resolved result rather than choosing among parallel intent labels.

## Maintenance protocol

Update this file in the same change when any of the following moves: package ownership, the production request path, public endpoints, state scope, persistence authority, supported commands, version contract, deployment gate, or a known limitation listed above.

Keep transient branch names, temporary debugging notes, individual task status, unverified plans, secrets, and user data out of this file. Put release steps in [`deployment.md`](deployment.md), contributor workflow in [`../CONTRIBUTING.md`](../CONTRIBUTING.md), and AI behavior rules in [`../AGENTS.md`](../AGENTS.md).
