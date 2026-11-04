import { createAdRewardLedgerFake } from '../../test/fakes/ad-reward-ledger.fake';
import { CoinLedgerRepository, LedgerPrincipal } from './coin-ledger.repository';

const GUEST: LedgerPrincipal = { type: 'guest', id: '11111111-1111-4111-8111-111111111111' };
const ACCOUNT: LedgerPrincipal = { type: 'account', id: '22222222-2222-4222-8222-222222222222' };
const DAY = '2026-11-04';

describe('CoinLedgerRepository.grantAdReward', () => {
  let fake: ReturnType<typeof createAdRewardLedgerFake>;
  let repo: CoinLedgerRepository;

  beforeEach(() => {
    fake = createAdRewardLedgerFake();
    repo = new CoinLedgerRepository(fake.dataSource);
  });

  it('grants to the Guest Ledger before any promotion', async () => {
    await expect(repo.grantAdReward(GUEST, DAY, 'ad:txn-1')).resolves.toMatchObject({ granted: true, amount: 10, balance: 10 });
    expect(fake.balanceOf(GUEST)).toBe(10);
    expect(fake.balanceOf(ACCOUNT)).toBe(0);
  });

  it.each(['committed', 'needs_attention'] as const)(
    'redirects a Guest economy-promoted into an account (package %s)',
    async (status) => {
      fake.commitPromotion(GUEST.id, ACCOUNT.id, 'economy', status);

      await expect(repo.grantAdReward(GUEST, DAY, 'ad:txn-1')).resolves.toMatchObject({
        granted: true,
        amount: 10,
        balance: 10,
        adsCompleted: 1,
        replayed: false,
      });
      expect(fake.entryFor('ad:txn-1')).toMatchObject({ principal_type: 'account', principal_id: ACCOUNT.id, granted: true });
      expect(fake.balanceOf(ACCOUNT)).toBe(10);
      expect(fake.adsCompletedOf(ACCOUNT, DAY)).toBe(1);
      expect(fake.balanceOf(GUEST)).toBe(0);
      expect(fake.adsCompletedOf(GUEST, DAY)).toBe(0);
    },
  );

  it('leaves the grant on the Guest after a data-only promotion', async () => {
    fake.commitPromotion(GUEST.id, ACCOUNT.id, 'data-only');
    await repo.grantAdReward(GUEST, DAY, 'ad:txn-1');
    expect(fake.entryFor('ad:txn-1')).toMatchObject({ principal_type: 'guest', principal_id: GUEST.id });
    expect(fake.balanceOf(ACCOUNT)).toBe(0);
  });

  it('does not redirect while the promotion is only staged', async () => {
    fake.commitPromotion(GUEST.id, ACCOUNT.id, 'economy', 'staged');
    await repo.grantAdReward(GUEST, DAY, 'ad:txn-1');
    expect(fake.balanceOf(GUEST)).toBe(10);
  });

  it("holds a redirected grant to the account's Reward Day ad limit", async () => {
    for (const txn of ['a', 'b', 'c']) await repo.grantAdReward(ACCOUNT, DAY, `ad:${txn}`);
    fake.commitPromotion(GUEST.id, ACCOUNT.id, 'economy');

    await expect(repo.grantAdReward(GUEST, DAY, 'ad:txn-guest')).resolves.toMatchObject({ granted: false, amount: 0, balance: 30 });
    expect(fake.balanceOf(ACCOUNT)).toBe(30);
    expect(fake.balanceOf(GUEST)).toBe(0);
  });

  it('replays a redirected grant by source key against the account', async () => {
    fake.commitPromotion(GUEST.id, ACCOUNT.id, 'economy');
    await repo.grantAdReward(GUEST, DAY, 'ad:txn-1');

    await expect(repo.grantAdReward(GUEST, DAY, 'ad:txn-1')).resolves.toMatchObject({
      granted: true,
      amount: 10,
      balance: 10,
      adsCompleted: 1,
      replayed: true,
    });
    expect(fake.balanceOf(ACCOUNT)).toBe(10);
  });

  it('replays a grant that landed on the Guest before commit against the Guest Ledger', async () => {
    await repo.grantAdReward(GUEST, DAY, 'ad:txn-1');
    fake.commitPromotion(GUEST.id, ACCOUNT.id, 'economy');

    await expect(repo.grantAdReward(GUEST, DAY, 'ad:txn-1')).resolves.toMatchObject({ replayed: true, balance: 10, adsCompleted: 1 });
    expect(fake.balanceOf(ACCOUNT)).toBe(0);
  });

  it('share-locks the promotion package before claiming the idempotency latch', async () => {
    await repo.grantAdReward(GUEST, DAY, 'ad:txn-1');
    expect(fake.statements[0]).toMatch(/FROM promotion\.transfer_packages WHERE guest_id = \$1 FOR SHARE$/);
    expect(fake.statements[1]).toMatch(/^INSERT INTO economy\.coin_ledger_entries/);
  });

  it('never consults promotion state for an account-owned attempt', async () => {
    await repo.grantAdReward(ACCOUNT, DAY, 'ad:txn-1');
    expect(fake.statements.some((s) => s.includes('promotion.transfer_packages'))).toBe(false);
  });
});
