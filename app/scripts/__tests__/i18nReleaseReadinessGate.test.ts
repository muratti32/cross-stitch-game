import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildResources } from '../generate-i18n-resources';
import { runReleaseReadinessGate } from '../i18n-release-readiness-gate';

const locales = ['en', 'tr', 'es', 'de', 'fr', 'pt-BR', 'it'];
const manifest = Object.fromEntries(locales.map((locale) => [locale, { nativeSpeakerReviewed: true, sensitiveCopyReviewed: true }]));

function fixture(): { root: string; generated: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-release-gate-'));
  const generated = path.join(root, 'resources.generated.json');
  for (const locale of locales) {
    const dir = path.join(root, 'locales', locale); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'common.json'), JSON.stringify({ greeting: locale === 'en' ? 'Welcome' : `Hello ${locale}`, item_one: locale === 'en' ? 'item' : 'one', item_other: locale === 'en' ? 'items' : 'many' }));
  }
  fs.writeFileSync(generated, `${JSON.stringify(buildResources(path.join(root, 'locales')), null, 2)}\n`);
  return { root, generated, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function run(root: string, generated: string, extra: Partial<Parameters<typeof runReleaseReadinessGate>[0]> = {}) {
  return runReleaseReadinessGate({ localesDir: path.join(root, 'locales'), generatedPath: generated, reviewManifest: manifest, declaredNativeLocales: locales, backendLocales: locales, ...extra });
}

describe('i18n release readiness gate', () => {
  it('passes a complete, reviewed seven-locale cohort', () => { const f = fixture(); try { expect(run(f.root, f.generated)).toEqual({ status: 'PASS', failures: [] }); } finally { f.cleanup(); } });

  it('reports a wholly absent candidate directory without crashing', () => { const f = fixture(); try { fs.rmSync(path.join(f.root, 'locales', 'fr'), { recursive: true }); const result = run(f.root, f.generated); expect(result.failures).toContain('[fr][namespace/key parity] locale directory missing; all English keys are absent'); } finally { f.cleanup(); } });

  it.each([
    ['missing nested key', (f: ReturnType<typeof fixture>) => fs.writeFileSync(path.join(f.root, 'locales', 'es', 'common.json'), JSON.stringify({ greeting: 'Hola', item_one: 'uno', item_other: 'muchos' }))],
    ['stale generated resources', (f: ReturnType<typeof fixture>) => fs.appendFileSync(f.generated, 'stale')],
    ['mismatched placeholder', (f: ReturnType<typeof fixture>) => fs.writeFileSync(path.join(f.root, 'locales', 'de', 'common.json'), JSON.stringify({ greeting: 'Hallo {{name}}', item_one: 'eins', item_other: 'viele' }))],
    ['missing plural member', (f: ReturnType<typeof fixture>) => fs.writeFileSync(path.join(f.root, 'locales', 'fr', 'common.json'), JSON.stringify({ greeting: 'Salut', item_one: 'un' }))],
  ])('fails independently: %s', (_name, mutate) => { const f = fixture(); try { mutate(f); expect(run(f.root, f.generated).status).toBe('FAIL'); } finally { f.cleanup(); } });

  it('fails an unreviewed locale, copied English, native drift, and missing/extra namespace', () => {
    const f = fixture(); try {
      const candidate = { ...manifest, es: { nativeSpeakerReviewed: false, sensitiveCopyReviewed: true } };
      fs.writeFileSync(path.join(f.root, 'locales', 'it', 'common.json'), JSON.stringify({ greeting: 'Welcome', item_one: 'uno', item_other: 'muchos' }));
      fs.writeFileSync(path.join(f.root, 'locales', 'it', 'extra.json'), '{}');
      const result = run(f.root, f.generated, { reviewManifest: candidate, declaredNativeLocales: locales.filter((locale) => locale !== 'pt-BR') });
      expect(result.status).toBe('FAIL');
      expect(result.failures.some((failure) => failure.includes('[es][review]'))).toBe(true);
      expect(result.failures.some((failure) => failure.includes('[it][copied English]'))).toBe(true);
      expect(result.failures.some((failure) => failure.includes('[native declarations] pt-BR'))).toBe(true);
      expect(result.failures.some((failure) => failure.includes('[it][namespace/key parity] extra'))).toBe(true);
    } finally { f.cleanup(); }
  });

  it('does not fail a copied-English pair when it is explicitly allowlisted', () => {
    const f = fixture(); try {
      fs.writeFileSync(path.join(f.root, 'locales', 'tr', 'common.json'), JSON.stringify({ greeting: 'Welcome', item_one: 'one', item_other: 'items' }));
      const result = run(f.root, f.generated, { copiedEnglishAllowlist: { 'common:greeting': 'fixture brand name' } });
      expect(result.failures.some((failure) => failure.includes('[tr][copied English] common:greeting'))).toBe(false);
    } finally { f.cleanup(); }
  });
});
