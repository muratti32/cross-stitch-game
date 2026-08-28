import { compareLocaleKeys } from '../localeParity';

describe('compareLocaleKeys', () => {
  it('reports no violations for identical key sets', () => {
    const reference = { settings: { header: { title: 'Settings' } } };
    const target = { settings: { header: { title: 'Ayarlar' } } };

    expect(compareLocaleKeys(reference, target)).toEqual({
      missingFromTarget: [],
      missingFromReference: [],
    });
  });

  it('fails a key present in the reference locale and missing from the target locale', () => {
    const reference = { settings: { header: { title: 'Settings', subtitle: 'Configure' } } };
    const target = { settings: { header: { title: 'Ayarlar' } } };

    expect(compareLocaleKeys(reference, target)).toEqual({
      missingFromTarget: [{ namespace: 'settings', keyPath: 'header.subtitle' }],
      missingFromReference: [],
    });
  });

  it('fails a key present in the target locale and missing from the reference locale', () => {
    const reference = { settings: { header: { title: 'Settings' } } };
    const target = { settings: { header: { title: 'Ayarlar', subtitle: 'Yapılandır' } } };

    expect(compareLocaleKeys(reference, target)).toEqual({
      missingFromTarget: [],
      missingFromReference: [{ namespace: 'settings', keyPath: 'header.subtitle' }],
    });
  });

  it('compares leaf key paths in nested JSON, not just top-level keys', () => {
    const reference = {
      settings: {
        accountDeletion: {
          pendingTitle: 'Pending',
          nested: { deeplyNested: 'Deep' },
        },
      },
    };
    const target = {
      settings: {
        accountDeletion: {
          pendingTitle: 'Beklemede',
          // "nested" key present at the same top-level key, but its leaf
          // "deeplyNested" is missing - a top-level-only comparison would
          // miss this.
          nested: {},
        },
      },
    };

    expect(compareLocaleKeys(reference, target)).toEqual({
      missingFromTarget: [{ namespace: 'settings', keyPath: 'accountDeletion.nested.deeplyNested' }],
      missingFromReference: [],
    });
  });

  it('names the offending keys and the namespace they live in, across multiple namespaces', () => {
    const reference = {
      settings: { header: { title: 'Settings' } },
      onboarding: { step1: { title: 'Welcome' } },
    };
    const target = {
      settings: { header: { title: 'Ayarlar', extra: 'Fazladan' } },
      onboarding: {},
    };

    expect(compareLocaleKeys(reference, target)).toEqual({
      missingFromTarget: [{ namespace: 'onboarding', keyPath: 'step1.title' }],
      missingFromReference: [{ namespace: 'settings', keyPath: 'header.extra' }],
    });
  });
});
