# Cross Stitch Game

This is a game. Game info/design docs live under `vault/wiki/` — check there for context on mechanics, content, etc.

## Application Decisions and Context

Before answering questions or taking action about the application, AI agents must read `CONTEXT.md` and search the relevant architecture decision records under `docs/adr/`. Use these files as the source of truth for previously accepted application terminology, information, constraints, and decisions.

## App Metadata and Services

Before answering questions or taking action about the app identity, store listing, platform targets, languages, external services, infrastructure providers, authentication or push-service boundaries, provisioning status, or privacy posture, AI agents must read `docs/app-metadata.md` and use it as the canonical inventory. Cross-check the underlying product and architecture decisions in `CONTEXT.md` and `docs/adr/`. Never invent account or project IDs, domains, credentials, secrets, or provisioning status; add only confirmed public identifiers and secret-manager reference names to `docs/app-metadata.md`, never secret values.

## Wiki

When the user refers to the "wiki," interpret it as the `vault/wiki/` directory. Before answering a question about the wiki or its contents, search the relevant files under `vault/wiki/` and base the answer on what you find there.

## CrossCraft Reference

When the user refers to the CrossCraft application, inspect the project at `/Volumes/ssd/react_native_workspace/stitch-master` for the relevant implementation and context before answering or taking action.
