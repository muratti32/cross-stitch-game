import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Repository } from 'typeorm';

import type { PatternEntity } from '../catalog/entities';
import { personalPatternObjectKeys } from '../catalog/pattern-object-keys';
import type { ObjectStorage } from '../catalog/storage/object-storage.interface';
import { ConversionService } from './conversion.service';

describe('ConversionService personal Pattern Thumbnails', () => {
  const patternId = '11111111-1111-4111-8111-111111111111';
  const otherPatternId = '22222222-2222-4222-8222-222222222222';
  const secret = 'thumbnail-test-secret';
  const exp = Math.floor(Date.now() / 1000) + 300;
  let patterns: Pick<Repository<PatternEntity>, 'findOneBy'>;
  let storage: Pick<ObjectStorage, 'get'>;
  let service: ConversionService;

  beforeEach(() => {
    patterns = { findOneBy: jest.fn() };
    storage = { get: jest.fn() };
    service = new ConversionService(
      { grantSigningSecret: secret } as never,
      {} as never,
      {} as never,
      {} as never,
      storage as ObjectStorage,
      {} as never,
      {} as never,
      {} as never,
      patterns as Repository<PatternEntity>,
      {} as never,
    );
  });

  function signature(id: string, expiration: number): string {
    return createHmac('sha256', secret)
      .update(`personal-preview:${id}:${expiration}`)
      .digest('hex');
  }

  function personalPattern(thumbnailRendererVersion: number | null): PatternEntity {
    return {
      id: patternId,
      thumbnailRendererVersion,
      visibility: 'personal',
    } as PatternEntity;
  }

  it('returns bytes for both variants using a valid preview grant', async () => {
    const keys = personalPatternObjectKeys(patternId);
    const browsing = Buffer.from('browsing');
    const detail = Buffer.from('detail');
    (patterns.findOneBy as jest.Mock).mockResolvedValue(personalPattern(1));
    (storage.get as jest.Mock).mockImplementation((key: string) =>
      Promise.resolve(key === keys.thumbnailBrowsing ? browsing : detail),
    );

    await expect(
      service.getSignedThumbnail(patternId, 'browsing', exp, signature(patternId, exp)),
    ).resolves.toBe(browsing);
    await expect(
      service.getSignedThumbnail(patternId, 'detail', exp, signature(patternId, exp)),
    ).resolves.toBe(detail);
    expect(storage.get).toHaveBeenCalledWith(keys.thumbnailBrowsing);
    expect(storage.get).toHaveBeenCalledWith(keys.thumbnailDetail);
  });

  it('rejects wrong and expired preview grants', async () => {
    await expect(
      service.getSignedThumbnail(patternId, 'browsing', exp, signature(otherPatternId, exp)),
    ).rejects.toEqual(new ForbiddenException('Invalid or expired thumbnail grant'));
    await expect(
      service.getSignedThumbnail(patternId, 'browsing', exp - 600, signature(patternId, exp - 600)),
    ).rejects.toEqual(new ForbiddenException('Invalid or expired thumbnail grant'));
    expect(patterns.findOneBy).not.toHaveBeenCalled();
  });

  it('returns NotFound when no Thumbnail was stored', async () => {
    (patterns.findOneBy as jest.Mock).mockResolvedValue(personalPattern(null));

    await expect(
      service.getSignedThumbnail(patternId, 'browsing', exp, signature(patternId, exp)),
    ).rejects.toEqual(new NotFoundException('Personal Pattern Thumbnail not found'));
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('returns NotFound when the stored Thumbnail object is missing', async () => {
    (patterns.findOneBy as jest.Mock).mockResolvedValue(personalPattern(1));
    (storage.get as jest.Mock).mockResolvedValue(null);

    await expect(
      service.getSignedThumbnail(patternId, 'detail', exp, signature(patternId, exp)),
    ).rejects.toEqual(new NotFoundException('Personal Pattern Thumbnail not found'));
  });

  it('does not let a preview grant for one Pattern unlock another Pattern', async () => {
    await expect(
      service.getSignedThumbnail(otherPatternId, 'browsing', exp, signature(patternId, exp)),
    ).rejects.toEqual(new ForbiddenException('Invalid or expired thumbnail grant'));
  });
});
