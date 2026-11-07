import { createFileHandoffStore, HANDOFF_FILENAME, parseHandoff } from '../handoffStore';
import type { PromotionHandoff } from '../handoff';
import { base, captured, GUEST_ID, packaged, PATTERN_A, preview, SESSION_A } from './fixtures';

const mockFiles = new Map<string, string>();
const mockDirectory = { value: 'file:///docs/' as string | null };

jest.mock('expo-file-system/legacy', () => ({
  get documentDirectory() {
    return mockDirectory.value;
  },
  getInfoAsync: jest.fn(async (path: string) => ({ exists: mockFiles.has(path) })),
  readAsStringAsync: jest.fn(async (path: string) => {
    const content = mockFiles.get(path);
    if (content === undefined) throw new Error('missing');
    return content;
  }),
  writeAsStringAsync: jest.fn(async (path: string, content: string) => {
    mockFiles.set(path, content);
  }),
  deleteAsync: jest.fn(async (path: string) => {
    mockFiles.delete(path);
  }),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    const content = mockFiles.get(from);
    if (content === undefined) throw new Error('missing source');
    if (mockFiles.has(to)) throw new Error('destination exists');
    mockFiles.set(to, content);
    mockFiles.delete(from);
  }),
}));

const LIVE = `file:///docs/${HANDOFF_FILENAME}`;
const PENDING = `${LIVE}.next`;

const everyPhase = (): PromotionHandoff[] => [
  captured(),
  { ...base(), phase: 'previewing', notice: 'stale' },
  { ...base(), phase: 'disclosing', preview: preview(), notice: null },
  { ...base(), phase: 'committing', preview: preview(), step: { kind: 'stage', lockToken: 'L' } },
  { ...base(), phase: 'syncing', promotionMode: 'data-only', acked: { likes: [], sessions: ['s'] } },
  { ...base(), phase: 'needsAttention', promotionMode: 'economy', acked: { likes: ['p'], sessions: [] } },
];

beforeEach(() => {
  mockFiles.clear();
  mockDirectory.value = 'file:///docs/';
});

describe('file handoff store', () => {
  test.each(everyPhase().map((handoff) => [handoff.phase, handoff] as const))(
    'round-trips a %s handoff',
    async (_phase, handoff) => {
      const store = createFileHandoffStore();

      await store.save(handoff);

      expect(await store.load()).toEqual(handoff);
    },
  );

  test('a second save replaces the first and leaves no pending file', async () => {
    const store = createFileHandoffStore();
    await store.save(captured());
    await store.save({ ...base(), phase: 'previewing', notice: null });

    expect(await store.load()).toMatchObject({ phase: 'previewing' });
    expect(mockFiles.has(PENDING)).toBe(false);
  });

  test('clear removes the handoff', async () => {
    const store = createFileHandoffStore();
    await store.save(captured());

    await store.clear();

    expect(await store.load()).toBeNull();
  });

  test('a kill after the pending file was written but before the swap recovers the new handoff', async () => {
    const store = createFileHandoffStore();
    await store.save(captured());
    const next = JSON.stringify({ version: 1, handoff: { ...base(), phase: 'previewing', notice: null } });
    mockFiles.delete(LIVE);
    mockFiles.set(PENDING, next);

    expect(await store.load()).toMatchObject({ phase: 'previewing' });
    expect(mockFiles.has(LIVE)).toBe(true);
  });

  test('a kill during the pending write keeps the previous handoff', async () => {
    const store = createFileHandoffStore();
    await store.save(captured());
    mockFiles.set(PENDING, '{"version":1,"handoff":{"phase":');

    expect(await store.load()).toMatchObject({ phase: 'captured' });
  });

  test('a corrupt file reads as no handoff instead of throwing', async () => {
    mockFiles.set(LIVE, 'not json');

    await expect(createFileHandoffStore().load()).resolves.toBeNull();
  });

  test('without a document directory nothing is stored and nothing throws', async () => {
    mockDirectory.value = null;
    const store = createFileHandoffStore();

    await expect(store.save(captured())).resolves.toBeUndefined();
    await expect(store.load()).resolves.toBeNull();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});

describe('parseHandoff', () => {
  test.each([
    ['a foreign version', { version: 2, handoff: captured() }],
    ['an unknown phase', { version: 1, handoff: { ...captured(), phase: 'finished' } }],
    ['a disclosing handoff without a valid preview', { version: 1, handoff: { ...base(), phase: 'disclosing', preview: {}, notice: null } }],
    ['a committing handoff with a bad step', { version: 1, handoff: { ...base(), phase: 'committing', preview: preview(), step: { kind: 'stage' } } }],
    ['a syncing handoff without acknowledgements', { version: 1, handoff: { ...base(), phase: 'syncing', promotionMode: 'economy' } }],
    ['a handoff without a manifest', { version: 1, handoff: { ...captured(), manifest: null } }],
    ['a non-object', 'x'],
    ['a packaged session list that is not a list', { version: 1, handoff: { ...captured(), sessions: 'x' } }],
    ['a packaged session without its bitmap', { version: 1, handoff: { ...captured(), sessions: [{ ...packaged(), packedBitmapBase64: 1 }] } }],
    ['a packaged session with an unknown status', { version: 1, handoff: { ...captured(), sessions: [{ ...packaged(), status: 'gone' }] } }],
  ])('rejects %s', (_label, raw) => {
    expect(parseHandoff(raw)).toBeNull();
  });

  test('a handoff file written by the #281 build parses with no packaged sessions and server-known targets', () => {
    const { sessions: _sessions, drain, ...rest } = base();
    const written = {
      version: 1,
      handoff: {
        ...rest,
        drain: { likes: drain.likes, sessions: [{ guestSessionId: SESSION_A, patternId: PATTERN_A }] },
        phase: 'syncing',
        promotionMode: 'economy',
        acked: { likes: [], sessions: [] },
      },
    };

    expect(parseHandoff(JSON.parse(JSON.stringify(written)))).toMatchObject({
      guestId: GUEST_ID,
      phase: 'syncing',
      sessions: [],
      drain: { sessions: [{ guestSessionId: SESSION_A, patternId: PATTERN_A, serverKnown: true }] },
    });
  });

  test('a local-only target stays local-only across a save', () => {
    const handoff = captured({
      drain: { likes: [], sessions: [{ guestSessionId: 'session_local_1', patternId: 'starter_heart', serverKnown: false }] },
    });

    expect(parseHandoff({ version: 1, handoff })).toEqual(handoff);
  });
});
