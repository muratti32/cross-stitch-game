import { imageResourceIdentity } from '../imageResourceIdentity';

describe('imageResourceIdentity', () => {
  it('ignores rotating private grant parameters', () => {
    expect(imageResourceIdentity('https://api.test/image/1?exp=100&sig=old')).toBe(
      'https://api.test/image/1',
    );
    expect(imageResourceIdentity('https://api.test/image/1?sig=new&exp=200')).toBe(
      'https://api.test/image/1',
    );
  });

  it('preserves parameters that identify image content', () => {
    expect(imageResourceIdentity('https://api.test/image/1?variant=detail&exp=100&sig=x')).toBe(
      'https://api.test/image/1?variant=detail',
    );
  });
});
