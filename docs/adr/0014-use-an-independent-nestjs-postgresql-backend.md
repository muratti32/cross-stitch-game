# Use an independent NestJS and PostgreSQL backend

The Game Backend uses NestJS for its API and application services and PostgreSQL as the durable source of truth. It is owned and deployed by this game and shares no runtime, database, schema, account records, commerce state, or job lifecycle with CrossCraft. CrossCraft may inform algorithms and service boundaries, but any reused idea is implemented against this game's domain language, contracts, security model, and data ownership rather than called as a shared production dependency.

We accept duplicated infrastructure and the cost of maintaining a separate backend in exchange for independent releases, failure isolation, security boundaries, data lifecycle control, and freedom to evolve the game's catalog, economy, moderation, and stitching model without CrossCraft compatibility constraints. Using the same NestJS and PostgreSQL family preserves relevant engineering experience without coupling the products.
