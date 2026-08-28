/**
 * The locales the app binary bundles translations for (#155: English and
 * Turkish for the first release). Adding a third language means adding a
 * locale folder under `locales/` and regenerating the bundled JSON. No
 * application-code registry needs editing.
 */
import resources from './resources.generated.json';

export type SupportedLocale = keyof typeof resources;

export const SUPPORTED_LOCALES = Object.keys(resources) as SupportedLocale[];
