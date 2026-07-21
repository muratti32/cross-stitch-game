# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# next.config.ts sets output:"standalone"; `next build` emits a self-contained
# server under .next/standalone plus the static assets under .next/static.
RUN npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

# The standalone output bundles only the node_modules the server actually needs.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

USER node

EXPOSE 3000
STOPSIGNAL SIGTERM

# The standalone bundle's entrypoint honours PORT and HOSTNAME from the env above.
CMD ["node", "server.js"]
