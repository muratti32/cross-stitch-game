/**
 * Guards the failure that shipped the Locator alert with an empty title and a
 * ": 1 · : 0" body on a real device: `t('price.label', { ns: 'catalog' })`
 * named a key that does not exist (the real path is `detail.price.label`), and
 * parseMissingKeyHandler renders a missing key as an empty string rather than
 * the raw key - so a wrong key path is invisible until a player hits it.
 */
import fs from 'fs';
import path from 'path';

const APP_ROOT = path.resolve(__dirname, '../../..');
const SCAN_ROOTS = ['app', 'src'].map((dir) => path.join(APP_ROOT, dir));
const LOCALES_DIR = path.join(APP_ROOT, 'src/i18n/locales/en');
const SKIP_DIRS = new Set(['node_modules', '__tests__', 'locales']);

// `t('some.key', { ..., ns: 'namespace' })` - the cross-namespace call shape.
const NAMESPACED_CALL = /\bt\(\s*'([^']+)'\s*,\s*\{[^}]*\bns:\s*'([^']+)'/g;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...sourceFiles(path.join(dir, entry.name)));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

function lookup(tree: unknown, keyPath: string): unknown {
  let cursor: unknown = tree;
  for (const segment of keyPath.split('.')) {
    if (typeof cursor !== 'object' || cursor === null || !(segment in cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

describe('cross-namespace translation keys', () => {
  const namespaces = new Map<string, unknown>(
    fs
      .readdirSync(LOCALES_DIR)
      .filter((file) => file.endsWith('.json'))
      .map((file) => [
        file.replace(/\.json$/, ''),
        JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8')) as unknown,
      ]),
  );

  it('resolves every `ns:`-qualified key against the English locale', () => {
    const unresolved: string[] = [];

    for (const root of SCAN_ROOTS) {
      for (const file of sourceFiles(root)) {
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(NAMESPACED_CALL)) {
          const [, keyPath, namespace] = match;
          const relative = path.relative(APP_ROOT, file);
          const tree = namespaces.get(namespace);
          if (tree === undefined) {
            unresolved.push(`${relative}: unknown namespace '${namespace}'`);
            continue;
          }
          // A plural key lives only as its suffixed forms in the JSON.
          const resolved =
            lookup(tree, keyPath) ?? lookup(tree, `${keyPath}_one`) ?? lookup(tree, `${keyPath}_other`);
          if (typeof resolved !== 'string') {
            unresolved.push(`${relative}: '${namespace}:${keyPath}'`);
          }
        }
      }
    }

    expect(unresolved).toEqual([]);
  });
});
