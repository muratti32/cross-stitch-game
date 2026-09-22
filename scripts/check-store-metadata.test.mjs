import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkStoreMetadata,
  countCharacters,
  APP_STORE_LOCALES,
  PLAY_LOCALES,
} from './check-store-metadata.mjs';

const buildMetadata = ({ appInfo = {}, version = {}, play = {} } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'store-metadata-'));

  const appInfoDir = join(dir, 'app-info');
  mkdirSync(appInfoDir, { recursive: true });
  for (const locale of APP_STORE_LOCALES) {
    writeFileSync(
      join(appInfoDir, `${locale}.json`),
      JSON.stringify({ name: 'Name', subtitle: 'Subtitle', ...(appInfo[locale] ?? {}) }),
    );
  }

  const versionDir = join(dir, 'version', '1.3');
  mkdirSync(versionDir, { recursive: true });
  for (const locale of APP_STORE_LOCALES) {
    writeFileSync(
      join(versionDir, `${locale}.json`),
      JSON.stringify({ description: 'Description', keywords: 'one,two', ...(version[locale] ?? {}) }),
    );
  }

  const playDir = join(dir, 'play');
  mkdirSync(playDir, { recursive: true });
  for (const locale of PLAY_LOCALES) {
    writeFileSync(
      join(playDir, `${locale}.json`),
      JSON.stringify({
        title: 'Title',
        shortDescription: 'Short description',
        fullDescription: '',
        ...(play[locale] ?? {}),
      }),
    );
  }

  return dir;
};

test('reports no problems for metadata within every limit', () => {
  assert.deepEqual(checkStoreMetadata(buildMetadata()), []);
});

test('reports an App Store name over 30 characters', () => {
  const dir = buildMetadata({ appInfo: { 'de-DE': { name: 'Kreuzstich und Nadelspitze Spiel' } } });
  const problems = checkStoreMetadata(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^app-info de-DE: name is 32 characters, limit 30/);
});

test('reports a keywords string over 100 characters', () => {
  const dir = buildMetadata({ version: { 'en-US': { keywords: 'a'.repeat(101) } } });
  const problems = checkStoreMetadata(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^version 1\.3 en-US: keywords is 101 characters, limit 100/);
});

test('reports a Play short description over 80 characters', () => {
  const dir = buildMetadata({ play: { 'en-US': { shortDescription: 'b'.repeat(81) } } });
  const problems = checkStoreMetadata(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^play en-US: shortDescription is 81 characters, limit 80/);
});

test('accepts an empty full description but not an over-long one', () => {
  assert.deepEqual(checkStoreMetadata(buildMetadata({ play: { fil: { fullDescription: '' } } })), []);
  const problems = checkStoreMetadata(buildMetadata({ play: { fil: { fullDescription: 'c'.repeat(4001) } } }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^play fil: fullDescription is 4001 characters, limit 4000/);
});

test('reports missing and unexpected locales', () => {
  const dir = buildMetadata();
  writeFileSync(join(dir, 'play', 'xx-XX.json'), JSON.stringify({ title: 'Title' }));
  const problems = checkStoreMetadata(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^play: unexpected locales — xx-XX$/);
});

test('counts a code point once, not its UTF-16 units', () => {
  assert.equal(countCharacters('🧵'), 1);
  assert.equal(countCharacters('十字繡'), 3);
  assert.equal(countCharacters('Cross Stitch&Needlepoint Game'), 29);
});

test('expects the expanded App Store locale set and reports a missing one', () => {
  assert.equal(APP_STORE_LOCALES.length, 38);
  for (const locale of ['tr', 'en-GB', 'en-CA', 'en-AU', 'fr-CA', 'es-MX']) {
    assert.ok(APP_STORE_LOCALES.includes(locale), `${locale} is missing from APP_STORE_LOCALES`);
  }

  const dir = buildMetadata();
  rmSync(join(dir, 'app-info', 'tr.json'));
  const problems = checkStoreMetadata(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^app-info: missing locales — tr$/);
});

test('keeps the Play locale set at 33 while the App Store set grows', () => {
  assert.equal(PLAY_LOCALES.length, 33);
  for (const locale of ['tr-TR', 'en-GB', 'en-CA', 'en-AU', 'fr-CA', 'es-MX']) {
    assert.ok(!PLAY_LOCALES.includes(locale), `${locale} should not be in PLAY_LOCALES yet`);
  }
});

test('requires full locale coverage only from the newest version', () => {
  const dir = buildMetadata();
  const shippedDir = join(dir, 'version', '1.2');
  mkdirSync(shippedDir, { recursive: true });
  writeFileSync(
    join(shippedDir, 'en-US.json'),
    JSON.stringify({ description: 'Description', keywords: 'one,two' }),
  );
  assert.deepEqual(checkStoreMetadata(dir), []);

  rmSync(join(dir, 'version', '1.3', 'tr.json'));
  const problems = checkStoreMetadata(dir);
  assert.deepEqual(problems, ['version 1.3: missing locales — tr']);
});
