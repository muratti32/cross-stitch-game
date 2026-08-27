/**
 * #157's migration gate. The i18n runtime, resolution, and the Settings
 * language picker UI all exist and work, but per #155's rollout plan this
 * stays closed until every planned slice has landed - a Turkish-language
 * device must never see a half-translated app mid-migration.
 *
 * While closed:
 *   - The active App Display Language is pinned to English regardless of
 *     device language or any stored override.
 *   - The Settings language picker is hidden.
 *   - Automatic selection from the device language never runs.
 *
 * A developer may flip this to `true` locally to exercise the real
 * resolution/picker/translation path (e.g. to verify the Settings screen in
 * Turkish). It must stay `false` in every commit that ships to players.
 *
 * The real gate-removal ticket is #167 ("until #12 removes the gate" in
 * #157's body is stale local numbering). Removing the gate is its own
 * change, after the final localization slice - never bundled into a slice.
 */
export const LANGUAGE_MIGRATION_GATE_OPEN = false;
