import { decodeCursor, encodeCursor } from './catalog.utils';

describe('catalog keyset cursor', () => {
  it('round-trips publishedAt and id', () => {
    const cursor = {
      publishedAt: '2026-07-14T10:00:05.000Z',
      id: 'a7e6d0ac-9d1f-4d5c-8b78-9a1f2e3d4c5b',
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('returns null for garbage input', () => {
    expect(decodeCursor('not-base64-json')).toBeNull();
    expect(
      decodeCursor(Buffer.from('{"unexpected":true}').toString('base64')),
    ).toBeNull();
    expect(decodeCursor(Buffer.from('[1,2,3]').toString('base64'))).toBeNull();
  });
});
