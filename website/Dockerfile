# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* at build time. Coolify forwards build-time env vars as
# --build-arg, so surface them as ARG -> ENV before `vite build` runs. Without
# this the bundle ships with empty API URLs and the account-deletion form breaks.
ARG VITE_API_URL
ARG VITE_ADMIN_CONSOLE_URL
ENV VITE_API_URL=$VITE_API_URL \
    VITE_ADMIN_CONSOLE_URL=$VITE_ADMIN_CONSOLE_URL

RUN npm run build

FROM nginx:alpine AS runtime

# SPA fallback: React Router client routes (/privacy-policy, /support,
# /account-deletion) are direct-hit store-compliance URLs, so every unknown path
# must resolve to index.html instead of 404ing.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
STOPSIGNAL SIGQUIT

CMD ["nginx", "-g", "daemon off;"]
