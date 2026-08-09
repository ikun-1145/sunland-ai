# Deployment runbook

## Required Worker secrets

Set these separately for production and `--env staging`:

- `APP_JWT_SECRET` — the existing application JWT HMAC secret.
- `SUPABASE_URL` — `https://klyrasrqgxijwrxuoevj.supabase.co`.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only Supabase service-role credential.

Never put any of these values in Wrangler configuration, client code, an APK,
logs, CI artifacts, or issue text.

## Safe deployment sequence

```bash
npm run typecheck
npm test
npm run build
npx wrangler deploy --env staging
curl --fail --silent --show-error https://ai-core-staging.sunland.dev/healthz
```

Run the authenticated contract suite against staging, including replaying the
same `turnId`, reusing it with a different body, migration receipt replay,
cross-user isolation, cancellation, rate limiting, and forced Supabase failure.
Only then deploy production:

```bash
npx wrangler deploy
curl --fail --silent --show-error https://ai-core.sunland.dev/healthz
```

`sunland_ai_turn_results` entries expire after seven days and the Worker cron
removes expired rows daily.

## Mainland reachability gate

Probe staging and production twice through China Mobile, China Unicom, and China
Telecom from at least three mainland cities. Record DNS, TLS, status, and total
latency without recording JWTs or request bodies.

If the direct custom domain does not meet the acceptance threshold, add a
Cloudflare Service Binding from the existing `api.sunland.dev` Worker and expose
the same API under `/sunland/v1/*`; do not create an open HTTP proxy. Repeat the
same probes. If both paths fail, stop client cleanup and release promotion.

## Database migrations

Apply only the numbered preparation migrations directly under
`supabase/migrations` during this release. Do not
apply `supabase/migrations/deferred/20260808_enforce_legacy_rls_after_forced_upgrade.sql`
until all of the following are true:

1. The historic Android keystore, alias, and passwords are available.
2. The signed APK installs over `1.2.1+27` without uninstalling.
3. The GitHub release and checksum are published.
4. Mainland APK download succeeds.
5. `update.json` has been promoted to the forced version and the old app cannot
   bypass the upgrade.

After the deferred migration, test as `anon`, user A, user B, and
`service_role`, then rerun Supabase Security and Performance Advisors.

Until that gate, `conversations` and `usage` remain legacy-compatible with RLS
disabled. The short-lived database token does not make those two tables
cross-user-safe by itself: PostgreSQL ignores their installed policies until
RLS is enabled. Never describe the preparation phase as full legacy-table
isolation, and never enable RLS early unless the old signed app can upgrade.
