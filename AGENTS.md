# Sunland AI contributor guide for coding agents

This file is the canonical repository instruction set for AI coding tools. It applies to the whole repository. Read [`docs/project-memory.md`](docs/project-memory.md) before making architectural or cross-package changes.

## Project overview

Sunland AI is a private TypeScript monorepo for a deterministic symbolic conversational engine. Production clients send authenticated turns to a Cloudflare Worker; they do not download or execute the Core. The Worker verifies identity, serializes each user's operations through a Durable Object, runs `@sunland-ai/core`, and commits durable state to Supabase.

The Core does not call an LLM or an external AI provider. Its behavior is implemented by parsers, semantic candidate planning, structured knowledge and memory, graph reasoning, dialogue state, and personality rendering.

## Repository map

- `packages/core/`: framework-independent symbolic engine. `src/sdk.ts` is the only supported public entry point.
- `apps/api/`: Cloudflare Worker, JWT authentication, per-user Durable Object, request validation, and Supabase repository.
- `apps/playground/`: Vite/React visual scaffold. It is not a production client and is not connected to the API.
- `supabase/migrations/`: production database migrations. `deferred/` contains a release-gated migration that normal deploys must not apply.
- `docs/`: repository-wide architecture, development, API, deployment, and durable project context.
- `packages/core/docs/`: detailed Core contracts and historical launch material.

## Sources of truth

When sources disagree, use this order:

1. Runtime code and database migrations.
2. Tests and versioned SDK contracts.
3. `package.json`, `wrangler.jsonc`, and `.dev.vars.example` configuration.
4. Current documentation.
5. Historical audit documents and comments that describe earlier repository layouts.

Do not infer current behavior from the archived v0.1.0 Web/Flutter audit documents. Preserve historical conclusions, but label them as archived when editing them.

## Commands

Run commands from the repository root unless noted otherwise.

```bash
npm install
npm run typecheck
npm test
npm run build
```

Focused commands:

```bash
npm test --workspace @sunland-ai/core
npm run test:contract --workspace @sunland-ai/core
npm test --workspace @sunland-ai/api
npm run dev:api
npm run dev:playground
```

`npm run build` performs a Cloudflare dry-run build and writes ignored output. It does not deploy. There is currently no repository lint script; do not document or invoke one as if it exists.

## Change workflow

1. Inspect the working tree and relevant implementation before editing.
2. Search for existing abstractions and tests; extend them instead of creating parallel logic.
3. For new capabilities or major design choices, study maintained upstream projects and official documentation, then adapt proven patterns without copying code.
4. Make the smallest production-ready change. Avoid unrelated refactors.
5. Add or update focused tests for runtime behavior changes.
6. Run focused checks first, then the root typecheck, test, and build commands when runtime or configuration changes warrant them.
7. Review the final diff for correctness, security, accidental generated files, and documentation drift.

Documentation-only changes should at minimum run `git diff --check`, validate relative links, and confirm that every documented command exists in a package script or tool configuration. Run the full suite when documentation asserts exact runtime behavior or when the user requests it.

## Architecture invariants

- Keep `packages/core/src/sdk.ts` as the only external Core import boundary. Do not add host behavior to the Core.
- Keep the Core independent of Cloudflare, Supabase, React, DOM APIs, network clients, authentication, and external model providers.
- Production clients call the Worker API. Do not reintroduce client-side Core bundles or duplicate Core decisions in Web, Flutter, or UI adapters.
- `apps/api` owns authentication, authorization boundaries, input limits, rate limiting, idempotency, concurrency, and persistence failures.
- Derive the user from the verified HS256 JWT `id` claim. Never trust a body or query `userId`.
- Durable Objects serialize operations and keep ephemeral rate-limit state; Supabase is the durable source of truth.
- Knowledge and name memory are scoped per verified user. Conversation context is scoped per user and conversation. Turn results are keyed by user and `turnId`.
- Reusing a `turnId` with the same normalized request must be idempotent; reusing it with different input must fail.
- Core side-effect safety is not optional. Semantic candidates cannot bypass the established Knowledge or Memory write gates.
- Personality may change wording, never facts, reasoning results, confidence, or state ownership.
- Treat restored storage, context, migrations, HTTP bodies, and database responses as untrusted input.

## Database and deployment safety

- Never edit or apply a database migration casually. Schema, authentication, and permission changes require explicit maintainer approval.
- Numbered migrations directly under `supabase/migrations/` are the normal preparation set.
- Do not apply `supabase/migrations/deferred/20260808_enforce_legacy_rls_after_forced_upgrade.sql` until every gate in [`docs/deployment.md`](docs/deployment.md) is satisfied.
- Never put secrets, real JWTs, Supabase keys, production request bodies, or user data in source, tests, logs, docs, commits, issues, or chat.
- Use `APP_JWT_PRIMARY_SECRET`, `APP_JWT_LEGACY_SECRET`, `SUPABASE_PROJECT_URL`, and `SUPABASE_SECRET_KEY` as the preferred configuration names. Legacy aliases exist only for staged rotation.
- A persistence failure must not be reported as a successful turn.

## TypeScript and testing conventions

- Match the existing strict TypeScript, ESM, two-space indentation, double-quote, semicolon, and trailing-comma style.
- Prefer `import type` for type-only imports and explicit `readonly` data where the surrounding API uses it.
- Keep functions deterministic and dependency-injected when time, storage, or runtime behavior needs testing.
- Tests use Vitest and normally live beside Core source or under `apps/api/test/` for Worker code.
- Cover happy paths, invalid input, boundary values, recovery, user isolation, idempotency, and failure behavior appropriate to the change.
- Do not update `packages/core/contracts/sdk-api-surface.v0.1.0.json` merely to make a failing contract test pass. Public surface changes require an intentional versioning decision.

## Documentation conventions

- Keep `README.md` in English and `README.zh-CN.md` in Simplified Chinese; update both when shared onboarding facts change.
- Use repository-relative links and runnable commands. Clearly label production, local development, examples, and historical material.
- Do not claim features that only appear in plans, placeholder UI, or archived audits.
- Update [`docs/project-memory.md`](docs/project-memory.md) when stable architecture, ownership, deployment gates, supported commands, or known limitations change.
- Keep `AGENT.md` and `CLAUDE.md` as compatibility entry points; do not duplicate the full rules from this file into them.

## Git hygiene

- Preserve unrelated user changes and generated output.
- Stage explicit paths only. Use Conventional Commit subjects such as `docs: refresh project documentation`.
- Do not commit secrets, `.dev.vars`, build directories, dependency directories, or machine-specific files.
- Do not deploy, apply migrations, rotate credentials, merge, tag, or publish a release without explicit authorization.
