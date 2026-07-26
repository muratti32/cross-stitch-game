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
    expect(keys.thumbnailBrowsing).toBe('personal-patterns/pat-1/thumbnail-browsing.png');
    expect(keys.thumbnailDetail).toBe('personal-patterns/pat-1/thumbnail-detail.png');
    expect(keys.all).toEqual([
      'personal-patterns/pat-1/artifact-v1.bin',
      'personal-patterns/pat-1/preview.png',
      'personal-patterns/pat-1/thumbnail-browsing.png',
      'personal-patterns/pat-1/thumbnail-detail.png',
    ]);
  });

  it('derives catalog Pattern keys with the artifact.bin asymmetry', () => {
    const keys = catalogPatternObjectKeys('pat-1');
    expect(keys.artifact).toBe('patterns/pat-1/artifact.bin');
    expect(keys.preview).toBe('patterns/pat-1/preview.png');
    expect(keys.thumbnailBrowsing).toBe('patterns/pat-1/thumbnail-browsing.png');
    expect(keys.thumbnailDetail).toBe('patterns/pat-1/thumbnail-detail.png');
    expect(keys.all).toEqual([
      'patterns/pat-1/artifact.bin',
      'patterns/pat-1/preview.png',
      'patterns/pat-1/thumbnail-browsing.png',
      'patterns/pat-1/thumbnail-detail.png',
    ]);
  });

  it('derives Official Pattern Draft keys', () => {
    const keys = officialPatternDraftObjectKeys('draft-1');
    expect(keys.artifact).toBe('official-pattern-drafts/draft-1/artifact-v1.bin');
    expect(keys.preview).toBe('official-pattern-drafts/draft-1/preview.png');
    expect(keys.thumbnailBrowsing).toBe('official-pattern-drafts/draft-1/thumbnail-browsing.png');
    expect(keys.thumbnailDetail).toBe('official-pattern-drafts/draft-1/thumbnail-detail.png');
    expect(keys.all).toEqual([
      'official-pattern-drafts/draft-1/artifact-v1.bin',
      'official-pattern-drafts/draft-1/preview.png',
      'official-pattern-drafts/draft-1/thumbnail-browsing.png',
      'official-pattern-drafts/draft-1/thumbnail-detail.png',
    ]);
  });

  it('derives Catalog Submission keys', () => {
    const keys = catalogSubmissionObjectKeys('sub-1');
    expect(keys.artifact).toBe('catalog-submissions/sub-1/artifact-v1.bin');
    expect(keys.preview).toBe('catalog-submissions/sub-1/preview.png');
    expect(keys.thumbnailBrowsing).toBe('catalog-submissions/sub-1/thumbnail-browsing.png');
    expect(keys.thumbnailDetail).toBe('catalog-submissions/sub-1/thumbnail-detail.png');
    expect(keys.all).toEqual([
      'catalog-submissions/sub-1/artifact-v1.bin',
      'catalog-submissions/sub-1/preview.png',
      'catalog-submissions/sub-1/thumbnail-browsing.png',
      'catalog-submissions/sub-1/thumbnail-detail.png',
    ]);
  });

  it('only the catalog namespace drops the -v1 suffix from the artifact key', () => {
    expect(catalogPatternObjectKeys('x').artifact.endsWith('/artifact.bin')).toBe(true);
    expect(personalPatternObjectKeys('x').artifact.endsWith('/artifact-v1.bin')).toBe(true);
    expect(officialPatternDraftObjectKeys('x').artifact.endsWith('/artifact-v1.bin')).toBe(true);
    expect(catalogSubmissionObjectKeys('x').artifact.endsWith('/artifact-v1.bin')).toBe(true);
  });

  describe('storedPatternObjectKeys', () => {
    it('returns both column-backed keys and drops thumbnail keys when thumbnailRendererVersion is null', () => {
      const keys = storedPatternObjectKeys({
        artifactObjectKey: 'a-key',
        id: 'pat-1',
        previewObjectKey: 'p-key',
        thumbnailRendererVersion: null,
        visibility: 'catalog',
      });
      expect(keys).toEqual(['a-key', 'p-key']);
    });

    it('returns artifact, preview, and personal thumbnail keys when visibility is personal and version is present', () => {
      const keys = storedPatternObjectKeys({
        artifactObjectKey: 'a-key',
        id: 'pat-1',
        previewObjectKey: 'p-key',
        thumbnailRendererVersion: 1,
        visibility: 'personal',
      });
      expect(keys).toEqual([
        'a-key',
        'p-key',
        'personal-patterns/pat-1/thumbnail-browsing.png',
        'personal-patterns/pat-1/thumbnail-detail.png',
      ]);
    });

    it('returns artifact, preview, and catalog thumbnail keys when visibility is catalog and version is present', () => {
      const keys = storedPatternObjectKeys({
        artifactObjectKey: 'a-key',
        id: 'pat-1',
        previewObjectKey: 'p-key',
        thumbnailRendererVersion: 1,
        visibility: 'catalog',
      });
      expect(keys).toEqual([
        'a-key',
        'p-key',
        'patterns/pat-1/thumbnail-browsing.png',
        'patterns/pat-1/thumbnail-detail.png',
      ]);
    });

    it('drops null keys', () => {
      const keys = storedPatternObjectKeys({
        artifactObjectKey: 'a-key',
        id: 'pat-1',
        previewObjectKey: null,
        thumbnailRendererVersion: null,
        visibility: 'catalog',
      });
      expect(keys).toEqual(['a-key']);
    });

    it('drops empty-string keys', () => {
      const keys = storedPatternObjectKeys({
        artifactObjectKey: '',
        id: 'pat-1',
        previewObjectKey: 'p-key',
        thumbnailRendererVersion: null,
        visibility: 'catalog',
      });
      expect(keys).toEqual(['p-key']);
    });

    it('de-duplicates repeated keys', () => {
      const keys = storedPatternObjectKeys({
        artifactObjectKey: 'same-key',
        id: 'pat-1',
        previewObjectKey: 'same-key',
        thumbnailRendererVersion: null,
        visibility: 'catalog',
      });
      expect(keys).toEqual(['same-key']);
    });
  });

  describe('storedPatternPublicObjectKeys', () => {
    it('excludes the artifact, keeping only the preview when thumbnailRendererVersion is null', () => {
      const keys = storedPatternPublicObjectKeys({
        artifactObjectKey: 'a-key',
        id: 'pat-1',
        previewObjectKey: 'p-key',
        thumbnailRendererVersion: null,
        visibility: 'catalog',
      });
      expect(keys).toEqual(['p-key']);
    });

    it('includes preview and personal thumbnail keys when visibility is personal and version is present', () => {
      const keys = storedPatternPublicObjectKeys({
        artifactObjectKey: 'a-key',
        id: 'pat-1',
        previewObjectKey: 'p-key',
        thumbnailRendererVersion: 1,
        visibility: 'personal',
      });
      expect(keys).toEqual([
        'p-key',
        'personal-patterns/pat-1/thumbnail-browsing.png',
        'personal-patterns/pat-1/thumbnail-detail.png',
      ]);
    });

    it('includes preview and catalog thumbnail keys when visibility is catalog and version is present', () => {
      const keys = storedPatternPublicObjectKeys({
        artifactObjectKey: 'a-key',
        id: 'pat-1',
        previewObjectKey: 'p-key',
        thumbnailRendererVersion: 1,
        visibility: 'catalog',
      });
      expect(keys).toEqual([
        'p-key',
        'patterns/pat-1/thumbnail-browsing.png',
        'patterns/pat-1/thumbnail-detail.png',
      ]);
    });

    it('drops a null preview and returns thumbnail keys if version is present', () => {
      const keys = storedPatternPublicObjectKeys({
        artifactObjectKey: 'a-key',
        id: 'pat-1',
        previewObjectKey: null,
        thumbnailRendererVersion: 1,
        visibility: 'catalog',
      });
      expect(keys).toEqual([
        'patterns/pat-1/thumbnail-browsing.png',
        'patterns/pat-1/thumbnail-detail.png',
      ]);
    });
  });
});
