# Stitch Wish Game Backend

This directory contains one NestJS codebase with two independently deployable processes:

- `backend-api` starts from `src/main.api.ts` and serves the versioned HTTP API.
- `backend-worker` starts from `src/main.worker.ts` as a standalone Nest application context. It does not open an HTTP server.

Both processes use the same modules, services, entities, and migrations. PostgreSQL is the source of truth. Redis and BullMQ provide at-least-once Processing Queue delivery and never own domain state.

## Prerequisites

- Node.js 20 or newer
- Python 3.12 for the sibling `conversion-engine` service
- npm
- Docker with Docker Compose

## Local setup

Install dependencies and create the local environment file:

```sh
npm install
cp .env.example .env
```

Start PostgreSQL 16 and Redis 7, then apply the database migrations:

```sh
docker compose up -d
npm run migration:run
```

Run the API and worker in separate terminals:

```sh
npm run start:api:dev
```

```sh
npm run start:worker:dev
```

Photo Pattern Conversion also requires the private Conversion Engine. From the
repository root, start it in a third terminal (the backend defaults
`CONVERSION_ENGINE_URL` to `http://127.0.0.1:8000`):

```sh
cd conversion-engine
. .venv/bin/activate
python -m stitch_wish
```

The API listens on `http://localhost:3000` by default. Verify the dependencies through the API health endpoint:

```sh
curl --fail-with-body http://localhost:3000/v1/health
```

Create and inspect a demo Processing Job:

```sh
curl --fail-with-body \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{"message":"hello stitch wish"}' \
  http://localhost:3000/v1/demo-jobs
```

Use the returned `id` in the status request:

```sh
curl --fail-with-body http://localhost:3000/v1/demo-jobs/JOB_ID
```

Stop the local infrastructure without deleting its volumes:

```sh
docker compose down
```

Add `--volumes` only when the local PostgreSQL and Redis data should be discarded.

### RevenueCat Test Store webhook lane

After the API, PostgreSQL, and Redis are running locally, one command validates
`http://127.0.0.1:3000/v1/health`, starts or reuses an ngrok HTTPS tunnel to port
3000, discovers its URL, and points the existing sandbox-only RevenueCat Test
Store webhook integration at the local Commerce Ledger endpoint:

```sh
cd backend
npm run revenuecat:test-store-lane
```

Install the ngrok agent first (`brew install ngrok` on macOS), then authenticate
it with `ngrok config add-authtoken ...` or provide `NGROK_AUTHTOKEN` locally.

Configure these values in `backend/.env` or your local shell:

- `REVENUECAT_API_V2_KEY`: secret v2 key with
  `project_configuration:apps:read` and
  `project_configuration:integrations:read_write`.
- `REVENUECAT_PROJECT_ID`: the Stitch Wish RevenueCat project ID.
- `REVENUECAT_TEST_STORE_APP_ID`: the RevenueCat Test Store app ID.
- `REVENUECAT_TEST_STORE_WEBHOOK_INTEGRATION_ID`: an existing integration that
  is `sandbox` only and either project-wide or already scoped to that Test Store
  app.
- `REVENUECAT_WEBHOOK_AUTH_TOKEN`: the same authorization value configured on
  the local Game Backend.
- `NGROK_AUTHTOKEN`: optional if ngrok already has credentials in its local
  configuration.

The command never creates an integration and refuses to write unless RevenueCat
confirms that the configured app is `test_store` and the existing integration is
`sandbox`. An existing project-wide sandbox integration is narrowed to the exact
Test Store app during the update; an integration already scoped to another app
is rejected. A production integration is always rejected before the update
request. Missing values, degraded backend health, a missing HTTPS tunnel, or any
RevenueCat API error stops the workflow. Re-running it safely reapplies the same
configuration and prints the effective public URL.

To stop an ngrok process started by this workflow (a reused process is left
alone):

```sh
npm run revenuecat:test-store-lane -- stop
```

Complete a purchase in the Test Store development build, then confirm the API
logs show a `RevenueCat webhook` outcome. For database-level confirmation,
inspect the local delivery archive and resulting Commerce Ledger rows:

```sql
SELECT received_at, verification_result, processing_outcome, failure_reason
FROM observability.webhook_delivery_archives
WHERE provider = 'revenuecat'
ORDER BY received_at DESC
LIMIT 5;

SELECT provider_transaction_id, environment, product_id, created_at
FROM economy.commerce_transaction_bindings
ORDER BY created_at DESC
LIMIT 5;
```

For a subscription, also inspect `economy.membership_periods`. The tunnel target
is always `https://<ngrok-host>/v1/commerce/revenuecat/webhook`.

## Production-style local run

Build both entrypoints, apply migrations, and start each compiled process in a separate terminal:

```sh
npm run build
npm run migration:run:prod
npm run start:api
```

```sh
npm run start:worker
```

Set `DATABASE_URL`, `REDIS_URL`, and secrets through the deployment platform. The
API and worker use the same environment contract because the worker also loads
authentication and session modules. Do not commit deployed credentials or copy
them into `.env.example`.

## Coolify production deployment

The repository root contains `compose.production.yml` for Coolify's Docker
Compose build pack. It runs the backend as three separate containers:

- `migrate` applies TypeORM migrations once and exits.
- `api` serves HTTP on container port 3000.
- `worker` dispatches email/job outboxes and consumes BullMQ work.

The Conversion Engine runs as a fourth, private service. The Compose file does
not use `env_file` and does not publish host ports. Coolify detects every
`${VARIABLE}` reference and injects values configured in its Environment
Variables panel at runtime.

Create a Docker Compose application in Coolify, select this repository, and set
the Compose file location to `/compose.production.yml`. Fill these required
runtime variables in the Coolify console:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Managed PostgreSQL connection URL |
| `REDIS_URL` | Managed Redis connection URL |
| `JWT_SECRET` | Access-token signing secret |
| `GRANT_SIGNING_SECRET` | Artifact-grant signing secret |
| `OTP_SIGNING_SECRET` | Email OTP verifier signing secret |
| `RESEND_API_KEY` | Resend server API key |
| `EMAIL_FROM_ADDRESS` | Sender on the verified Resend domain |
| `FIREBASE_PROJECT_ID` | Firebase project accepted by the SSO exchange endpoint |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | Base64-encoded Firebase Admin service-account JSON; API container only |

The Compose `:?` syntax marks these values as required, so Coolify blocks the
deployment while any is empty. Keep them runtime-only; none is needed during
the image build. Enable Coolify's `Literal` option when a value contains `$`,
percent-encode reserved characters inside connection-URL credentials, and do
not append a shell-style semicolon to `DATABASE_URL`. Generate a different
value for each signing secret:

```sh
openssl rand -hex 32
```

The TTL, rate-limit, conversion concurrency, and log-level variables have safe
defaults in Compose and remain editable in the Coolify panel.

Firebase credentials are intentionally passed only to the `api` service. Encode
the downloaded service-account JSON as a single line before storing it in the
deployment secret manager:

```sh
base64 < firebase-service-account.json | tr -d '\n'
```

The API verifies Firebase ID tokens and immediately exchanges them for
game-owned access and rotating refresh tokens. Neither the worker nor the
migration container needs Firebase Admin credentials.

In Coolify's service list, assign the public domain only to `api`. Because the
container listens on port 3000, enter the domain with that internal target, for
example `https://api.example.com:3000`. Coolify terminates TLS and proxies normal
HTTPS traffic to the container. Do not assign domains to `worker`, `migrate`, or
`conversion-engine`.

`api` waits for a successful migration container. `worker` additionally waits
for the Conversion Engine health check. `migrate` is excluded from Coolify's
ongoing health evaluation because it exits after applying pending migrations.
Inspect the migration container logs after every deployment; an overall deploy
message alone does not prove the database schema is current.

The production Compose file deliberately does not create PostgreSQL or Redis.
Use managed instances with backups, point-in-time recovery, TLS, and monitoring
as required by `docs/app-metadata.md`.

The current storage implementation is a Docker named volume shared by `api` and
`worker`. This is durable on one Docker host but is not multi-host object
storage. Do not scale these containers across hosts until `LocalObjectStorage`
is replaced by the accepted S3-compatible production implementation.

## Migrations

The TypeORM CLI DataSource is `src/database/data-source.ts`. Migrations live in `src/database/migrations` and application startup never synchronizes the schema automatically.

Create an empty migration:

```sh
npm run migration:create -- src/database/migrations/DescribeChange
```

Generate a migration from entity changes against the configured development database:

```sh
npm run migration:generate -- src/database/migrations/DescribeChange
```

Inspect, apply, or revert migrations:

```sh
npm run migration:show
npm run migration:run
npm run migration:revert
```

Review generated SQL before applying or committing a migration.

## Verification and tests

Run the same checks expected before handoff:

```sh
npm run build
npm run typecheck
npm run lint
npm test
```

Integration tests require a running Docker daemon. Testcontainers starts isolated real PostgreSQL and Redis containers; the local Compose services are not used:

```sh
npm run test:integration
```

## Job delivery architecture

`POST /v1/demo-jobs` commits a Processing Job and Job Outbox row in one PostgreSQL transaction. The worker deployable's dispatcher claims undispatched outbox rows with `FOR UPDATE SKIP LOCKED`, publishes each row to BullMQ using the outbox row identifier as `jobId`, and records dispatch in PostgreSQL. The consumer guards the database state transition before doing work, so at-least-once queue replays observe the existing state and cannot create a second terminal result.

The worker also reconciles dispatched or running PostgreSQL jobs against BullMQ. If Redis loses queue state or a delivery exhausts transient retries, reconciliation republishes the same retained outbox `jobId`; PostgreSQL remains authoritative and the guarded consumer resumes without creating another terminal result.

The module layout keeps shared configuration in `config`, authentication in `auth`, dependency checks in `health`, and queue/outbox infrastructure in `jobs`. Future bounded contexts such as `identity`, `catalog`, `economy`, `sessions`, and `events` can be added as peer modules without moving the existing infrastructure.

## API authentication convention

Guest Installation Identities and future Registered Accounts share short-lived access JWTs and rotating opaque refresh-token families. Apply `JwtAuthGuard` and use `@CurrentPrincipal()` on every future player-authenticated API endpoint. Guest bootstrap, refresh, logout, and health routes remain public because they establish or manage credentials directly; `GET /v1/auth/session` is the guarded end-to-end probe.
