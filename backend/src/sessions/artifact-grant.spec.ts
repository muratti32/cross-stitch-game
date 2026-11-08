import { buildArtifactGrant, signArtifactGrant } from './artifact-grant';

describe('artifact grant', () => {
  it('signs patternId:exp with HMAC-SHA256', () => {
    expect(signArtifactGrant('s', 'p', 10)).toMatch(/^[0-9a-f]{64}$/);
    expect(signArtifactGrant('s', 'p', 10)).toBe(signArtifactGrant('s', 'p', 10));
    expect(signArtifactGrant('s', 'p', 10)).not.toBe(signArtifactGrant('t', 'p', 10));
  });

  it('builds a url whose signature matches its expiry', () => {
    const grant = buildArtifactGrant('s', 300, {
      id: 'p',
      artifactByteLength: 9,
      artifactChecksum: 'c ',
      artifactSchemaVersion: 2,
    });
    const url = new URL(grant.grant.url, 'https://x');
    const exp = Number(url.searchParams.get('exp'));
    expect(url.searchParams.get('sig')).toBe(signArtifactGrant('s', 'p', exp));
    expect(grant.artifact).toEqual({ byteLength: 9, checksum: 'c', schemaVersion: 2 });
  });
});
