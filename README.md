# Sunland AI

Sunland AI is the server-owned Symbolic AI runtime used by the Sunland web and
Flutter clients. The clients send authenticated turns; they do not download or
execute the Symbolic Core.

## Repository layout

- `packages/core` — framework-independent Symbolic Core `0.1.0`, public SDK
  contracts, documentation, and the migrated 629-test suite.
- `apps/api` — Cloudflare Worker API and one Durable Object per verified user.
  Durable Objects serialize turns and hold only rate-limit/cache state;
  Supabase remains the durable source of truth.
- `apps/playground` — the React/Cytoscape development shell. It is never bundled
  into a web or Flutter client.
- `supabase/migrations` — production migrations. Files under
  `supabase/migrations/deferred` are release-gated and must not be applied by a
  normal deploy.

## Request flow

1. The client captures its already verified application identity and sends the
   application JWT in `Authorization: Bearer ...`.
2. The edge Worker verifies the HS256 signature and expiry. A `userId` supplied
   in a request body is ignored.
3. The verified JWT `id` selects a per-user Durable Object, which serializes the
   operation.
4. The object loads the latest revision from Supabase, executes Core `0.1.0`,
   and commits knowledge, name memory, semantic Context, and the idempotent turn
   result in one PostgreSQL transaction.
5. A revision conflict reloads and recomputes at most once. Persistence failure
   never returns a successful answer.

## Local verification

Requires Node.js 20 or newer.

```bash
npm install
npm run typecheck
npm test
npm run build
```

The Worker secrets are intentionally absent from the repository. Copy
`apps/api/.dev.vars.example` to `.dev.vars` only for local development and use
`wrangler secret put` for deployed environments.

See [`docs/deployment.md`](docs/deployment.md) for the release gates, staging
order, required secrets, and mainland connectivity fallback.

## Database safety gate

All numbered migrations directly under `supabase/migrations` are preparation
migrations. They create the closed AI schema and narrow the new
`authenticated` token's grants without revoking the legacy app's `anon`
permissions.

`conversations` and `usage` still have RLS disabled for compatibility with the
historically signed Flutter release. A PostgreSQL policy is not enforced while
RLS is disabled, so their final cross-user isolation is intentionally part of
the forced-upgrade gate rather than being claimed as active early.
The migration under `supabase/migrations/deferred` must remain unapplied until a
historically signed forced-update Flutter APK is proven installable over
`1.2.1+27`. It intentionally cannot be reached by a normal migration glob.
