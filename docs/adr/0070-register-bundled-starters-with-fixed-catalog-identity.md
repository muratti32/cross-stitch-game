# Register Bundled Starter Patterns with a fixed catalog identity

ADR-0037 assumed the Bundled Starter Patterns were in the server catalog, but production held no such rows, and `stitching_sessions.pattern_id` requires one. Each starter now has a fixed catalog UUID, used locally and on the server, so no boundary translates ids. The bundled-pattern generator is the only writer of the app manifest and the backend starter module. A worker seeder writes the objects first and then the row, and never updates an existing row. The rows stay visible in the catalog; current apps hide them because they show their own bundled entries.

`POST /v1/sessions/bundled` is the one registration door and accepts only starter ids. A Guest registers identity only, and a Guest's completed row stays local until promotion, because promotion accepts any completed Guest session as evidence for a pending First Completion Reward. An account uploads a bitmap, because checkpoints compact operations.

A session completed before registration is terminal and earns no First Completion Reward. A session completed after registration follows the ordinary rules, so a later session on the same starter can still earn it. Starters are sparse, so `catalog.patterns.stitchable_cell_count` sets their completion target and reward tier; null keeps `width * height`.

We accept a one-way local id migration, generated starter bytes in the backend source, and old apps showing four extra tiles, in exchange for one identity and no new Guest reward evidence.
