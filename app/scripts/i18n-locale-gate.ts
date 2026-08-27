/**
 * CI gate for translation key parity (#158): discovers every namespace
 * bundled under src/i18n/locales, and for each non-reference locale fails
 * the build if its keys diverge from the reference locale (English) in
 * either direction. Thin script-plus-pure-core wrapper around
 * compareLocaleKeys, mirroring scripts/perf-gate.ts's shape - all the
 * comparison logic lives in the pure core and is unit-tested there.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  compareLocaleKeys,
  LocaleParityViolation,
  LocaleResources,
  NamespaceResources,
} from '../src/i18n/localeParity';
import { FALLBACK_LOCALE } from '../src/i18n/resolveAppLanguage';
import { SUPPORTED_LOCALES } from '../src/i18n/supportedLocales';

const LOCALES_DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');

export interface LocaleGateResult {
  status: 'PASS' | 'FAIL';
  failures: string[];
}

/**
 * Namespaces are discovered from disk, not hardcoded, so a new feature's
 * translation file is picked up automatically. The set is the union of
 * every locale's `.json` files, so a namespace added only on one side of a
 * locale still gets compared rather than silently skipped.
 */
function listNamespaces(localesDir: string, locales: readonly string[]): string[] {
  const namespaces = new Set<string>();
  for (const locale of locales) {
    const localeDir = path.join(localesDir, locale);
    if (!fs.existsSync(localeDir)) {
      continue;
    }
    for (const file of fs.readdirSync(localeDir)) {
      if (file.endsWith('.json')) {
        namespaces.add(path.basename(file, '.json'));
      }
    }
  }
  return [...namespaces].sort();
}

/**
 * Loads one locale's resources for the given namespaces. A namespace file
 * that does not exist for this locale loads as an empty object, so every
 * one of the reference locale's keys for it is reported missing rather
 * than the namespace being silently skipped.
 */
function loadLocaleResources(
  localesDir: string,
  locale: string,
  namespaces: readonly string[],
): LocaleResources {
  const resources: LocaleResources = {};
  for (const namespace of namespaces) {
    const filePath = path.join(localesDir, locale, `${namespace}.json`);
    resources[namespace] = fs.existsSync(filePath)
      ? (JSON.parse(fs.readFileSync(filePath, 'utf8')) as NamespaceResources)
      : {};
  }
  return resources;
}

function formatViolation(
  missingFromLocale: string,
  presentInLocale: string,
  violation: LocaleParityViolation,
): string {
  return `[${violation.namespace}] '${violation.keyPath}' is missing from '${missingFromLocale}' (present in '${presentInLocale}')`;
}

/**
 * Runs the parity comparison for every supported locale against the
 * reference locale, reading resources from `localesDir`. Exported
 * separately from the English fallback default of `LOCALES_DIR` so the
 * logic is independently reachable, e.g. from a test with a fixture
 * directory.
 */
export function runLocaleGate(
  localesDir: string,
  referenceLocale: string = FALLBACK_LOCALE,
  locales: readonly string[] = SUPPORTED_LOCALES,
): LocaleGateResult {
  const namespaces = listNamespaces(localesDir, locales);
  const reference = loadLocaleResources(localesDir, referenceLocale, namespaces);

  const failures: string[] = [];
  for (const locale of locales) {
    if (locale === referenceLocale) {
      continue;
    }
    const target = loadLocaleResources(localesDir, locale, namespaces);
    const { missingFromTarget, missingFromReference } = compareLocaleKeys(reference, target);

    for (const violation of missingFromTarget) {
      failures.push(formatViolation(locale, referenceLocale, violation));
    }
    for (const violation of missingFromReference) {
      failures.push(formatViolation(referenceLocale, locale, violation));
    }
  }

  return { status: failures.length === 0 ? 'PASS' : 'FAIL', failures };
}

export function runCli(): void {
  const result = runLocaleGate(LOCALES_DIR);

  console.log('================================================================================');
  console.log(`LOCALE PARITY GATE (#158): ${result.status}`);
  console.log('================================================================================');

  if (result.status === 'FAIL') {
    console.log('FAILURES:');
    for (const failure of result.failures) {
      console.log(`- ${failure}`);
    }
  } else {
    console.log('Every bundled locale has the same translation keys, in every namespace.');
  }
  console.log('================================================================================');

  process.exit(result.status === 'FAIL' ? 1 : 0);
}

const isMain =
  typeof require !== 'undefined' && require.main === module
    ? true
    : process.argv[1]
    ? path.resolve(process.argv[1]) === __filename ||
      path.resolve(process.argv[1]) === path.resolve(__dirname, 'i18n-locale-gate.ts') ||
      path.resolve(process.argv[1]) === path.resolve(__dirname, 'i18n-locale-gate')
    : false;

if (isMain) {
  runCli();
}
