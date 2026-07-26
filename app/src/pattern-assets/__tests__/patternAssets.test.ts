import { absoluteThumbnailUrls } from '../../api/catalog';
import { Config } from '../../config';
import {
  selectPatternImage,
  type PatternImageAssets,
  type PatternSurfaceVariant,
} from '..';

const variants: PatternSurfaceVariant[] = ['browsing', 'detail'];

describe('Pattern asset selection', () => {
  test.each(variants)('uses the requested thumbnail variant when both thumbnails and a preview exist: %s', (variant) => {
    const assets: PatternImageAssets = {
      thumbnailUrls: {
        browsing: '  browsing-thumbnail  ',
        detail: '  detail-thumbnail  ',
      },
      previewUrl: '  preview-url  ',
    };

    expect(selectPatternImage(assets, variant)).toEqual({
      kind: 'thumbnail',
      variant,
      url: variant === 'browsing' ? 'browsing-thumbnail' : 'detail-thumbnail',
    });
  });

  test.each(variants)('uses the requested thumbnail variant without a preview: %s', (variant) => {
    const assets: PatternImageAssets = {
      thumbnailUrls: {
        browsing: 'browsing-thumbnail',
        detail: 'detail-thumbnail',
      },
    };

    expect(selectPatternImage(assets, variant)).toEqual({
      kind: 'thumbnail',
      variant,
      url: variant === 'browsing' ? 'browsing-thumbnail' : 'detail-thumbnail',
    });
  });

  test.each(variants)('falls back to the preview when thumbnailUrls is null: %s', (variant) => {
    expect(selectPatternImage({ thumbnailUrls: null, previewUrl: 'preview-url' }, variant)).toEqual({
      kind: 'preview',
      url: 'preview-url',
    });
  });

  test.each(variants)('returns none when thumbnailUrls is null and no preview exists: %s', (variant) => {
    expect(selectPatternImage({ thumbnailUrls: null }, variant)).toEqual({ kind: 'none' });
  });

  test.each(variants)('falls back to the preview when thumbnailUrls is undefined: %s', (variant) => {
    expect(selectPatternImage({ thumbnailUrls: undefined, previewUrl: 'preview-url' }, variant)).toEqual({
      kind: 'preview',
      url: 'preview-url',
    });
  });

  test.each(variants)('falls back when the requested thumbnail variant is empty and a preview exists: %s', (variant) => {
    const assets: PatternImageAssets = {
      thumbnailUrls:
        variant === 'browsing'
          ? { browsing: '', detail: 'detail-thumbnail' }
          : { browsing: 'browsing-thumbnail', detail: '' },
      previewUrl: 'preview-url',
    };

    expect(selectPatternImage(assets, variant)).toEqual({
      kind: 'preview',
      url: 'preview-url',
    });
  });

  test.each(variants)('returns none when the requested thumbnail variant is empty and no preview exists: %s', (variant) => {
    const assets: PatternImageAssets = {
      thumbnailUrls:
        variant === 'browsing'
          ? { browsing: '', detail: 'detail-thumbnail' }
          : { browsing: 'browsing-thumbnail', detail: '' },
    };

    expect(selectPatternImage(assets, variant)).toEqual({ kind: 'none' });
  });

  test.each(variants)('returns none for an empty preview without thumbnails: %s', (variant) => {
    expect(selectPatternImage({ previewUrl: '' }, variant)).toEqual({ kind: 'none' });
  });

  test.each(variants)('returns none for whitespace-only urls: %s', (variant) => {
    const assets: PatternImageAssets = {
      thumbnailUrls: { browsing: '  ', detail: '\t' },
      previewUrl: '\n ',
    };

    expect(selectPatternImage(assets, variant)).toEqual({ kind: 'none' });
  });
});

describe('absoluteThumbnailUrls', () => {
  test('absolutises relative thumbnail URLs', () => {
    expect(absoluteThumbnailUrls({ browsing: '/browsing', detail: '/detail' })).toEqual({
      browsing: `${Config.apiBaseUrl}/browsing`,
      detail: `${Config.apiBaseUrl}/detail`,
    });
  });

  test('preserves already-absolute thumbnail URLs', () => {
    expect(absoluteThumbnailUrls({
      browsing: 'https://cdn.example.com/browsing',
      detail: 'http://cdn.example.com/detail',
    })).toEqual({
      browsing: 'https://cdn.example.com/browsing',
      detail: 'http://cdn.example.com/detail',
    });
  });

  test('returns null for null and undefined thumbnail URLs', () => {
    expect(absoluteThumbnailUrls(null)).toBeNull();
    expect(absoluteThumbnailUrls(undefined)).toBeNull();
  });
});
