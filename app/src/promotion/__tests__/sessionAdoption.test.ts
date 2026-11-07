import type { DrainSessionResult } from '../../api/promotionContract';
import { adoptPromotedSession, getActiveIdentity } from '../../local-db';
import { copyOfflinePatternToNamespace } from '../../session-preparation';
import { adoptPackagedSession } from '../sessionAdoption';
import { ACCOUNT_ID, GUEST_ID, packaged, PATTERN_A } from './fixtures';

jest.mock('../../local-db', () => ({ adoptPromotedSession: jest.fn(), getActiveIdentity: jest.fn() }));
jest.mock('../../session-preparation', () => ({ copyOfflinePatternToNamespace: jest.fn() }));

const owners = { guestId: GUEST_ID, accountId: ACCOUNT_ID };
const server = (accountSessionId: string | null): DrainSessionResult => ({
  status: 'transferred',
  accountSessionId,
  revision: 1,
  packedBitmapBase64: null,
  terminalCompleted: false,
  isLocked: false,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getActiveIdentity).mockReturnValue(ACCOUNT_ID);
});

describe('adoptPackagedSession', () => {
  test('a personal session without a server session gets its artifact before its row', async () => {
    const order: string[] = [];
    jest.mocked(copyOfflinePatternToNamespace).mockImplementation(async () => {
      order.push('copy');
    });
    jest.mocked(adoptPromotedSession).mockImplementation(async () => {
      order.push('adopt');
    });
    const session = packaged({ source: 'personal', remoteSessionId: null });

    await adoptPackagedSession(owners, session, null);

    expect(copyOfflinePatternToNamespace).toHaveBeenCalledWith(PATTERN_A, GUEST_ID, ACCOUNT_ID);
    expect(order).toEqual(['copy', 'adopt']);
  });

  test('a catalog session the server no longer has keeps a playable artifact too', async () => {
    await adoptPackagedSession(owners, packaged(), server(null));

    expect(copyOfflinePatternToNamespace).toHaveBeenCalledTimes(1);
  });

  test('a session with a surviving server session re-downloads instead of copying', async () => {
    await adoptPackagedSession(owners, packaged({ source: 'personal' }), server('remote'));

    expect(copyOfflinePatternToNamespace).not.toHaveBeenCalled();
    expect(adoptPromotedSession).toHaveBeenCalledTimes(1);
  });

  test('a bundled session has no artifact file to copy', async () => {
    await adoptPackagedSession(owners, packaged({ source: 'bundled' }), null);

    expect(copyOfflinePatternToNamespace).not.toHaveBeenCalled();
  });

  test('never writes into a namespace that is not the account', async () => {
    jest.mocked(getActiveIdentity).mockReturnValue(GUEST_ID);

    await expect(adoptPackagedSession(owners, packaged(), null)).rejects.toThrow('namespace');

    expect(adoptPromotedSession).not.toHaveBeenCalled();
  });
});
