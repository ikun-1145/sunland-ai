# Contributing to Sunland AI

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh-CN.md)

Thank you for helping improve Sunland AI. This project favors small, evidence-backed changes that preserve its deterministic Core and server-owned security boundaries.

## Before you start

Read:

1. [README.md](README.md) for the product and repository overview.
2. [docs/architecture.md](docs/architecture.md) for runtime and state ownership.
3. The relevant detailed document under [packages/core/docs](packages/core/docs/) for Core changes.
4. [AGENTS.md](AGENTS.md) if you are using an AI coding tool.

Search the repository for existing code, tests, and documentation before proposing a new abstraction. For a new feature or a significant design decision, review maintained upstream projects and official documentation for proven patterns, then explain why the chosen approach fits this repository.

## Development setup

Requirements:

- Node.js 20 or later
- npm with workspace support

~~~bash
npm install
npm run typecheck
npm test
npm run build
~~~

For local servers and environment setup, follow [docs/development.md](docs/development.md).

## Repository conventions

- Keep runtime changes minimal and scoped to the request.
- Reuse existing abstractions and preserve package boundaries.
- Do not introduce a second parser, reasoning path, persistence owner, or client-side Core.
- Match the existing strict TypeScript and ESM style.
- Add focused Vitest coverage for behavior changes and meaningful edge cases.
- Treat Context, persisted snapshots, HTTP input, and migration payloads as untrusted.
- Never commit credentials, JWTs, user data, .dev.vars, dependencies, or generated build output.
- Update English and Simplified Chinese README files together when shared onboarding facts change.

## Testing

Run the smallest relevant check while iterating:

~~~bash
npm test --workspace @sunland-ai/core
npm run test:contract --workspace @sunland-ai/core
npm test --workspace @sunland-ai/api
~~~

Before submitting runtime or configuration changes, run:

~~~bash
npm run typecheck
npm test
npm run build
git diff --check
~~~

For documentation-only changes, validate commands and links against the current repository and run git diff --check. The repository currently has no lint script.

## Database, authentication, and public contracts

Database schema changes, authentication changes, permission changes, API breaking changes, and large refactors require an explicit design review before implementation.

Do not apply the migration under supabase/migrations/deferred as part of normal development or deployment. Do not update the Core API surface contract simply to accept an accidental export change. See:

- [docs/deployment.md](docs/deployment.md)
- [packages/core/docs/security-boundary.md](packages/core/docs/security-boundary.md)
- [packages/core/docs/versioning.md](packages/core/docs/versioning.md)

## Commits and pull requests

Use a descriptive branch and Conventional Commit subject:

~~~text
feat(core): add a bounded reasoning capability
fix(api): reject conflicting turn replay
docs: refresh contributor documentation
~~~

Keep each commit reviewable. A pull request should explain the user-visible outcome, the architectural boundary affected, tests run, security or migration considerations, and any intentionally unsupported cases.

Do not deploy, apply migrations, rotate secrets, tag, or publish as part of a contribution unless a maintainer explicitly authorizes that operation.
