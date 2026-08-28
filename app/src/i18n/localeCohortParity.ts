export function compareLocaleCohorts(appLocales: readonly string[], backendLocales: readonly string[]): string[] {
  const app = new Set(appLocales); const backend = new Set(backendLocales);
  return [...new Set([...appLocales, ...backendLocales])].filter((locale) => !app.has(locale) || !backend.has(locale)).sort();
}
