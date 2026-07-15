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

Set `DATABASE_URL`, `REDIS_URL`, and `PORT` through the deployment platform. The API deployable additionally requires `JWT_SECRET`; the worker and migration CLI do not need the signing secret. Do not commit deployed credentials or copy them into `.env.example`.

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
