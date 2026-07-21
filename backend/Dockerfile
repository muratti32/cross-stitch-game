# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS production-dependencies

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    PORT=3000 \
    STORAGE_LOCAL_DIR=/var/lib/stitch-wish/storage

WORKDIR /app

RUN mkdir -p /var/lib/stitch-wish/storage \
    && chown -R node:node /app /var/lib/stitch-wish

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json package-lock.json ./

USER node

EXPOSE 3000
STOPSIGNAL SIGTERM

# Default command dispatches on PROCESS_ROLE so a single image serves both the
# API and the worker for orchestrators that drive the container via the image's
# default command (e.g. Coolify Dockerfile apps, which ignore a custom start
# command). PROCESS_ROLE=worker runs the queue worker; anything else (default)
# runs pending TypeORM migrations — idempotent, already-applied ones are skipped
# — then the API. Docker Compose targets `runtime` and sets an explicit command
# per service, so it overrides this CMD and is unaffected.
CMD ["sh", "-c", "if [ \"$PROCESS_ROLE\" = worker ]; then exec node dist/main.worker.js; else node node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js && exec node dist/main.api.js; fi"]
