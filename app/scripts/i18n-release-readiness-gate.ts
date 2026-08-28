import * as fs from 'fs';
import * as path from 'path';
import { APP_LOCALE_CATALOG } from '../src/i18n/localeCatalog';
import { compareLocaleKeys, type LocaleResources, type NamespaceResources } from '../src/i18n/localeParity';
import { comparePlaceholderIdentity } from '../src/i18n/placeholderIdentity';
import { comparePluralFamilyCompatibility } from '../src/i18n/pluralFamilyCompatibility';
import { findCopiedEnglish, type CopiedEnglishAllowlist } from '../src/i18n/copiedEnglish';
import { COPIED_ENGLISH_ALLOWLIST } from '../src/i18n/copiedEnglishAllowlist';
import { validateLocaleReviewManifest } from '../src/i18n/localeReview';
import { compareNativeLocaleDeclarations } from '../src/i18n/nativeLocaleDeclaration';
import { compareLocaleCohorts } from '../src/i18n/localeCohortParity';
import { checkGeneratedResources } from './generate-i18n-resources';
import { CANDIDATE_APP_DISPLAY_LOCALES } from '../../backend/src/catalog/candidate-locales.constant';
import reviewManifest from '../src/i18n/localeReviewManifest.json';

const ROOT = path.join(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'src/i18n/locales');
const GENERATED_PATH = path.join(ROOT, 'src/i18n/resources.generated.json');
const CANDIDATES = APP_LOCALE_CATALOG.map((locale) => locale.identifier);

export interface ReleaseReadinessResult { status: 'PASS' | 'FAIL'; failures: string[]; }

function loadResources(localesDir: string, locale: string, namespaces: readonly string[]): LocaleResources {
  return Object.fromEntries(namespaces.map((namespace) => {
    const file = path.join(localesDir, locale, `${namespace}.json`);
    return [namespace, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as NamespaceResources : {}];
  }));
}

function namespaces(localesDir: string, locales: readonly string[]): string[] {
  const names = new Set<string>();
  for (const locale of locales) {
    const dir = path.join(localesDir, locale);
    if (fs.existsSync(dir)) fs.readdirSync(dir).filter((file) => file.endsWith('.json')).forEach((file) => names.add(file.slice(0, -5)));
  }
  return [...names].sort();
}

function localeNamespaces(localesDir: string, locale: string): Set<string> {
  const dir = path.join(localesDir, locale);
  return new Set(fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5)) : []);
}

function declaredNativeLocales(appJsonPath: string): string[] {
  const expo = JSON.parse(fs.readFileSync(appJsonPath, 'utf8')).expo ?? {};
  const ios = expo.ios?.infoPlist?.CFBundleLocalizations;
  const android = expo.android?.locales;
  return [...new Set([...(Array.isArray(ios) ? ios : []), ...(Array.isArray(android) ? android : [])])];
}

export interface GateOptions {
  localesDir?: string;
  generatedPath?: string;
  reviewManifest?: Partial<Record<string, { nativeSpeakerReviewed: boolean; sensitiveCopyReviewed: boolean }>>;
  declaredNativeLocales?: readonly string[];
  backendLocales?: readonly string[];
  copiedEnglishAllowlist?: CopiedEnglishAllowlist;
}

export function runReleaseReadinessGate(options: GateOptions = {}): ReleaseReadinessResult {
  const localesDir = options.localesDir ?? LOCALES_DIR;
  const namespaceNames = namespaces(localesDir, CANDIDATES);
  const reference = loadResources(localesDir, 'en', namespaceNames);
  const failures: string[] = [];
  if (!checkGeneratedResources(localesDir, options.generatedPath ?? GENERATED_PATH)) failures.push('[generated resources] resources.generated.json is stale');

  for (const locale of CANDIDATES) {
    const localeDirExists = fs.existsSync(path.join(localesDir, locale));
    if (!localeDirExists) {
      failures.push(`[${locale}][namespace/key parity] locale directory missing; all English keys are absent`);
      validateLocaleReviewManifest([locale], options.reviewManifest ?? reviewManifest).forEach((v) => failures.push(`[${locale}][review] ${v.reason}`));
      continue;
    }
    const candidate = loadResources(localesDir, locale, namespaceNames);
    if (locale !== 'en') {
      const referenceNamespaces = localeNamespaces(localesDir, 'en');
      const candidateNamespaces = localeNamespaces(localesDir, locale);
      [...candidateNamespaces].filter((namespace) => !referenceNamespaces.has(namespace)).sort().forEach((namespace) => failures.push(`[${locale}][namespace/key parity] extra namespace ${namespace}`));
      [...referenceNamespaces].filter((namespace) => !candidateNamespaces.has(namespace)).sort().forEach((namespace) => failures.push(`[${locale}][namespace/key parity] missing namespace ${namespace}`));
      const parity = compareLocaleKeys(reference, candidate);
      parity.missingFromTarget.forEach((v) => failures.push(`[${locale}][namespace/key parity] missing ${v.namespace}:${v.keyPath}`));
      parity.missingFromReference.forEach((v) => failures.push(`[${locale}][namespace/key parity] extra ${v.namespace}:${v.keyPath}`));
      comparePlaceholderIdentity(reference, candidate).forEach((v) => failures.push(`[${locale}][placeholder] ${v.namespace}:${v.keyPath} differs (${v.reference.join(',') || 'none'} vs ${v.candidate.join(',') || 'none'})`));
      comparePluralFamilyCompatibility(reference, candidate).forEach((v) => failures.push(`[${locale}][plural] ${v.namespace}:${v.baseKeyPath} missing ${v.missingForms.join(', ')}`));
      findCopiedEnglish(reference, candidate, options.copiedEnglishAllowlist ?? COPIED_ENGLISH_ALLOWLIST).forEach((v) => failures.push(`[${locale}][copied English] ${v.namespace}:${v.keyPath}`));
    }
    validateLocaleReviewManifest([locale], options.reviewManifest ?? reviewManifest).forEach((v) => failures.push(`[${locale}][review] ${v.reason}`));
  }

  compareNativeLocaleDeclarations(CANDIDATES, options.declaredNativeLocales ?? declaredNativeLocales(path.join(ROOT, 'app.json')))
    .forEach((v) => failures.push(`[native declarations] ${v.locale}: ${v.reason}`));
  compareLocaleCohorts(CANDIDATES, options.backendLocales ?? CANDIDATE_APP_DISPLAY_LOCALES)
    .forEach((locale) => failures.push(`[backend cohort] ${locale} differs from app candidate cohort`));
  return { status: failures.length ? 'FAIL' : 'PASS', failures };
}

export function runCli(): void {
  const result = runReleaseReadinessGate();
  console.log('================================================================================');
  console.log(`I18N RELEASE READINESS GATE (#173): ${result.status}`);
  console.log('================================================================================');
  if (result.failures.length) { console.log('FAILURES:'); result.failures.forEach((failure) => console.log(`- ${failure}`)); }
  else console.log('All candidate locales are complete, reviewed, declared, and cohort-aligned.');
  console.log('================================================================================');
  process.exit(result.status === 'FAIL' ? 1 : 0);
}

const isMain = typeof require !== 'undefined' && require.main === module;
if (isMain) runCli();
