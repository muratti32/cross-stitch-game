import { comparePlaceholderIdentity } from '../placeholderIdentity';
import { comparePluralFamilyCompatibility } from '../pluralFamilyCompatibility';
import { findCopiedEnglish } from '../copiedEnglish';
import { validateLocaleReviewManifest } from '../localeReview';
import { compareNativeLocaleDeclarations } from '../nativeLocaleDeclaration';
import { compareLocaleCohorts } from '../localeCohortParity';

describe('release readiness pure seams', () => {
  it('detects missing and extra interpolation tokens on shared leaves', () => {
    expect(comparePlaceholderIdentity({ commerce: { pay: 'Pay {{amount}}' } }, { commerce: { pay: 'Öde {{currency}}' } })).toEqual([
      { namespace: 'commerce', keyPath: 'pay', reference: ['amount'], candidate: ['currency'] },
    ]);
  });

  it('requires every plural form used by English, while allowing extra forms', () => {
    const reference = { commerce: { item_one: 'one', item_other: 'other' } };
    expect(comparePluralFamilyCompatibility(reference, { commerce: { item_one: 'bir' } })).toEqual([
      { namespace: 'commerce', baseKeyPath: 'item', missingForms: ['other'] },
    ]);
    expect(comparePluralFamilyCompatibility(reference, { commerce: { item_one: 'bir', item_other: 'çok', item_few: 'az' } })).toEqual([]);
  });

  it('reports copied English except for an exact allowlisted pair', () => {
    const reference = { catalog: { brand: 'Stitch Wish', title: 'Welcome' } };
    const candidate = { catalog: { brand: 'Stitch Wish', title: 'Welcome' } };
    expect(findCopiedEnglish(reference, candidate, { 'catalog:brand': 'brand name' })).toEqual([
      { namespace: 'catalog', keyPath: 'title', value: 'Welcome' },
    ]);
  });

  it('scopes language-specific copied-English exemptions to one locale', () => {
    const reference = { catalog: { dimensions: 'Dimensions' } };
    const candidate = { catalog: { dimensions: 'Dimensions' } };

    expect(findCopiedEnglish(reference, candidate, { 'fr:catalog:dimensions': 'French cognate' }, 'fr')).toEqual([]);
    expect(findCopiedEnglish(reference, candidate, { 'fr:catalog:dimensions': 'French cognate' }, 'de')).toEqual([
      { namespace: 'catalog', keyPath: 'dimensions', value: 'Dimensions' },
    ]);
  });

  it('requires both review flags for every cohort locale', () => {
    expect(validateLocaleReviewManifest(['en', 'tr'], { en: { nativeSpeakerReviewed: true, sensitiveCopyReviewed: true }, tr: { nativeSpeakerReviewed: false, sensitiveCopyReviewed: true } })).toEqual([
      { locale: 'tr', reason: 'native-speaker review incomplete' },
    ]);
  });

  it('compares native declarations as a set and reports drift', () => {
    expect(compareNativeLocaleDeclarations(['en', 'tr'], ['en', 'de'])).toEqual([
      { locale: 'tr', reason: 'not-declared' }, { locale: 'de', reason: 'unexpected-declared-locale' },
    ]);
  });

  it('compares app and backend candidate cohorts as sets', () => {
    expect(compareLocaleCohorts(['en', 'tr', 'es'], ['en', 'tr', 'de'])).toEqual(['de', 'es']);
    expect(compareLocaleCohorts(['en', 'tr'], ['tr', 'en'])).toEqual([]);
  });
});
