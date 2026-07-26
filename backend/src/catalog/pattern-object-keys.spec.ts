import {
  catalogPatternObjectKeys,
  catalogSubmissionObjectKeys,
  officialPatternDraftObjectKeys,
  personalPatternObjectKeys,
  storedPatternObjectKeys,
  storedPatternPublicObjectKeys,
} from './pattern-object-keys';

describe('pattern object keys', () => {
  it('derives Personal Pattern keys', () => {
    const keys = personalPatternObjectKeys('pat-1');
    expect(keys.artifact).toBe('personal-patterns/pat-1/artifact-v1.bin');
    expect(keys.preview).toBe('personal-patterns/pat-1/preview.png');
    expect(keys.all).toEqual([
      'personal-patterns/pat-1/artifact-v1.bin',
      'personal-patterns/pat-1/preview.png',
    ]);
  });

  it('derives catalog Pattern keys with the artifact.bin asymmetry', () => {
    const keys = catalogPatternObjectKeys('pat-1');
    expect(keys.artifact).toBe('patterns/pat-1/artifact.bin');
    expect(keys.preview).toBe('patterns/pat-1/preview.png');
    expect(keys.all).toEqual(['patterns/pat-1/artifact.bin', 'patterns/pat-1/preview.png']);
  });

  it('derives Official Pattern Draft keys', () => {
    const keys = officialPatternDraftObjectKeys('draft-1');
    expect(keys.artifact).toBe('official-pattern-drafts/draft-1/artifact-v1.bin');
    expect(keys.preview).toBe('official-pattern-drafts/draft-1/preview.png');
    expect(keys.all).toEqual([
      'official-pattern-drafts/draft-1/artifact-v1.bin',
      'official-pattern-drafts/draft-1/preview.png',
    ]);
  });

  it('derives Catalog Submission keys', () => {
    const keys = catalogSubmissionObjectKeys('sub-1');
    expect(keys.artifact).toBe('catalog-submissions/sub-1/artifact-v1.bin');
    expect(keys.preview).toBe('catalog-submissions/sub-1/preview.png');
    expect(keys.all).toEqual([
      'catalog-submissions/sub-1/artifact-v1.bin',
      'catalog-submissions/sub-1/preview.png',
    ]);
  });

  it('only the catalog namespace drops the -v1 suffix from the artifact key', () => {
    expect(catalogPatternObjectKeys('x').artifact.endsWith('/artifact.bin')).toBe(true);
    expect(personalPatternObjectKeys('x').artifact.endsWith('/artifact-v1.bin')).toBe(true);
    expect(officialPatternDraftObjectKeys('x').artifact.endsWith('/artifact-v1.bin')).toBe(true);
    expect(catalogSubmissionObjectKeys('x').artifact.endsWith('/artifact-v1.bin')).toBe(true);
  });

  describe('storedPatternObjectKeys', () => {
    it('returns both column-backed keys', () => {
      const keys = storedPatternObjectKeys({
        artifactObjectKey: 'a-key',
        previewObjectKey: 'p-key',
      });
      expect(keys).toEqual(['a-key', 'p-key']);
    });

    it('drops null keys', () => {
      const keys = storedPatternObjectKeys({
        artifactObjectKey: 'a-key',
        previewObjectKey: null,
      });
      expect(keys).toEqual(['a-key']);
    });

    it('drops empty-string keys', () => {
      const keys = storedPatternObjectKeys({
        artifactObjectKey: '',
        previewObjectKey: 'p-key',
      });
      expect(keys).toEqual(['p-key']);
    });

    it('de-duplicates repeated keys', () => {
      const keys = storedPatternObjectKeys({
        artifactObjectKey: 'same-key',
        previewObjectKey: 'same-key',
      });
      expect(keys).toEqual(['same-key']);
    });
  });

  describe('storedPatternPublicObjectKeys', () => {
    it('excludes the artifact, keeping only the preview', () => {
      const keys = storedPatternPublicObjectKeys({
        artifactObjectKey: 'a-key',
        previewObjectKey: 'p-key',
      });
      expect(keys).toEqual(['p-key']);
    });

    it('drops a null preview', () => {
      const keys = storedPatternPublicObjectKeys({
        artifactObjectKey: 'a-key',
        previewObjectKey: null,
      });
      expect(keys).toEqual([]);
    });
  });
});
