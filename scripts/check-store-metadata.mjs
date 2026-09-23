#!/usr/bin/env node
// Validates the canonical store listing copy under metadata/ against the
// character limits both stores enforce, and reports missing locales.
// See docs/adr/0065-separate-the-store-listing-name-from-the-brand-name.md.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

export const APP_STORE_LIMITS = { name: 30, subtitle: 30, keywords: 100 };
export const PLAY_LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000 };

export const APP_STORE_LOCALES = [
  'ar-SA', 'ca', 'cs', 'da', 'de-DE', 'el', 'en-AU', 'en-CA', 'en-GB', 'en-US',
  'es-ES', 'es-MX', 'fi', 'fr-CA', 'fr-FR', 'hi', 'hr', 'hu', 'id', 'it', 'ja',
  'ko', 'ms', 'nl-NL', 'no', 'pl', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sk', 'sl-SI',
  'sv', 'tr', 'uk', 'vi', 'zh-Hans', 'zh-Hant',
];

export const PLAY_LOCALES = [
  'en-US', 'ar', 'ca', 'cs-CZ', 'da-DK', 'de-DE', 'el-GR', 'en-AU', 'en-CA',
  'en-GB', 'es-419', 'es-ES', 'fi-FI', 'fil', 'fr-CA', 'fr-FR', 'hi-IN', 'hr',
  'hu-HU', 'id', 'it-IT', 'ja-JP', 'ko-KR', 'ms-MY', 'nl-NL', 'no-NO', 'pl-PL',
  'pt-BR', 'pt-PT', 'ro', 'ru-RU', 'sk', 'sl', 'sv-SE', 'tr-TR', 'uk', 'vi',
  'zh-CN', 'zh-TW',
];

// Apple and Google both count characters, not UTF-16 code units, so a
// surrogate pair (an emoji) counts once. Array.from iterates code points.
export const countCharacters = (value) => Array.from(value).length;

const listLocales = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => file.endsWith('.json'))
        .map((file) => basename(file, '.json'))
        .sort()
    : [];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const checkLimits = (scope, locale, fields, limits, problems) => {
  for (const [field, limit] of Object.entries(limits)) {
    const value = fields[field];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string') {
      problems.push(`${scope} ${locale}: ${field} is not a string`);
      continue;
    }
    const length = countCharacters(value);
    if (length > limit) {
      problems.push(
        `${scope} ${locale}: ${field} is ${length} characters, limit ${limit} — ${value}`,
      );
    }
  }
};

const checkCoverage = (scope, expected, present, problems) => {
  const missing = expected.filter((locale) => !present.includes(locale));
  const unexpected = present.filter((locale) => !expected.includes(locale));
  if (missing.length > 0) problems.push(`${scope}: missing locales — ${missing.join(', ')}`);
  if (unexpected.length > 0) problems.push(`${scope}: unexpected locales — ${unexpected.join(', ')}`);
};

export const checkStoreMetadata = (metadataDir) => {
  const problems = [];

  const appInfoDir = join(metadataDir, 'app-info');
  const appInfoLocales = listLocales(appInfoDir);
  checkCoverage('app-info', APP_STORE_LOCALES, appInfoLocales, problems);
  for (const locale of appInfoLocales) {
    checkLimits('app-info', locale, readJson(join(appInfoDir, `${locale}.json`)), APP_STORE_LIMITS, problems);
  }

  const versionsDir = join(metadataDir, 'version');
  const versions = existsSync(versionsDir)
    ? readdirSync(versionsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];
  // Only the newest version is still editable, so it is the only one expected to
  // carry every locale. Shipped versions keep the locale set they were released
  // with — back-filling them would rewrite history without reaching any user.
  const editableVersion = versions[versions.length - 1];
  for (const version of versions) {
    const versionDir = join(versionsDir, version);
    const locales = listLocales(versionDir);
    if (version === editableVersion) {
      checkCoverage(`version ${version}`, APP_STORE_LOCALES, locales, problems);
    }
    for (const locale of locales) {
      checkLimits(`version ${version}`, locale, readJson(join(versionDir, `${locale}.json`)), APP_STORE_LIMITS, problems);
    }
  }

  const playDir = join(metadataDir, 'play');
  if (existsSync(playDir)) {
    const playLocales = listLocales(playDir);
    checkCoverage('play', PLAY_LOCALES, playLocales, problems);
    for (const locale of playLocales) {
      checkLimits('play', locale, readJson(join(playDir, `${locale}.json`)), PLAY_LIMITS, problems);
    }
  } else {
    problems.push('play: metadata/play is missing');
  }

  return problems;
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const metadataDir = process.argv[2] ?? join(repoRoot, 'metadata');
  const problems = checkStoreMetadata(metadataDir);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error(`\n${problems.length} store metadata problem(s) found.`);
    process.exit(1);
  }
  console.log('Store metadata within limits for every locale.');
}
