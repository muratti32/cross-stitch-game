import {
  readSessionEnvelope,
  SESSION_ENVELOPE_KEY,
  writeSessionEnvelope,
  type SessionStore,
} from '../sessionEnvelope';

function store(initial: Record<string, string> = {}): SessionStore & { values: Record<string, string> } {
  const values = { ...initial };
  return {
    values,
    getItemAsync: async (key) => values[key] ?? null,
    setItemAsync: async (key, value) => { values[key] = value; },
    deleteItemAsync: async (key) => { delete values[key]; },
  };
}

const legacy = {
  guestId: 'guest', guestCreatedAt: 'created', accountId: 'account', accountEmail: 'email',
  accountProvider: 'provider', refreshToken: 'refresh', requiresSignIn: 'requires',
};

test('migrates legacy identity keys only after envelope write', async () => {
  const fake = store({ account: 'acc', email: 'a@example.com', provider: 'email', refresh: 'r' });
  const result = await readSessionEnvelope(fake, legacy);
  expect(result).toMatchObject({ kind: 'account', accountId: 'acc', refreshToken: 'r' });
  expect(JSON.parse(fake.values[SESSION_ENVELOPE_KEY])).toMatchObject({ accountId: 'acc' });
  expect(fake.values.account).toBeUndefined();
});

test('envelope storage failure is reported without throwing', async () => {
  const fake = store();
  fake.getItemAsync = async (key) => {
    if (key === SESSION_ENVELOPE_KEY) throw new Error('corrupt');
    return null;
  };
  await expect(readSessionEnvelope(fake, legacy)).resolves.toBeNull();
  fake.setItemAsync = async () => { throw new Error('unavailable'); };
  await expect(writeSessionEnvelope(fake, { version: 1, kind: 'none', guestId: null, guestCreatedAt: null, accountId: null, accountEmail: null, accountProvider: null, refreshToken: null, requiresSignIn: false })).resolves.toBe(false);
});
