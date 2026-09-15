import { ProfileTextPolicyService } from './profile-text-policy.service';

describe('ProfileTextPolicyService', () => {
  const policy = new ProfileTextPolicyService();

  it('normalizes public values deterministically', () => {
    expect(policy.normalizeUsername('  Needle_Artist  ')).toBe('needle_artist');
    expect(policy.normalizeDisplayName('  Needle   Artist  ')).toBe('Needle Artist');
  });

  it('rejects reserved identities, including segmented brand names', () => {
    expect(policy.rejectionReason('username', 'stitch_wish')).toBe(
      'Username contains a reserved name',
    );
    expect(policy.rejectionReason('display name', 'Official Artist')).toBe(
      'Display name contains a reserved name',
    );
  });

  it('rejects profanity and common obfuscation without substring matching display names', () => {
    expect(policy.rejectionReason('username', 'sh1t_artist')).toBe(
      'Username contains language that is not allowed',
    );
    expect(policy.rejectionReason('display name', 'f.u.c.k')).toBe(
      'Display name contains language that is not allowed',
    );
    expect(policy.rejectionReason('display name', 'Classic Assistant')).toBeNull();
  });

  it('rejects literal markup characters in normalized display names', () => {
    const normalized = policy.normalizeDisplayName('Artist ＜tag＞');

    expect(normalized).toBe('Artist <tag>');
    expect(policy.rejectionReason('display name', normalized)).toBe(
      'Display name contains markup characters',
    );
  });

  it('keeps reserved and profanity reasons ahead of the markup rule', () => {
    expect(policy.rejectionReason('display name', '<Official>')).toBe(
      'Display name contains a reserved name',
    );
    expect(policy.rejectionReason('display name', '<f.u.c.k>')).toBe(
      'Display name contains language that is not allowed',
    );
  });

  it('allows punctuation and international display names', () => {
    expect(
      policy.rejectionReason('display name', `O'Connor "Needle" & 织女`),
    ).toBeNull();
  });
});
