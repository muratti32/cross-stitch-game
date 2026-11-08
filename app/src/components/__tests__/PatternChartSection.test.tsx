import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Button } from '../Button';

import { PatternChartSection } from '../PatternChartSection';
import { usePatternChartAccess, usePurchasePatternChart } from '../../api/patternCharts';
import { useIdentityStore } from '../../identity/guestIdentity';
import { usePatternChartGeneration } from '../../hooks/usePatternChartGeneration';
import { mapPatternChartError } from '../../api/patternCharts';
import { useLocalArtifactChecksum } from '../../hooks/useLocalArtifactChecksum';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../api/patternCharts', () => ({
  ...jest.requireActual('../../api/patternCharts'),
  usePatternChartAccess: jest.fn(),
  usePurchasePatternChart: jest.fn(),
}));
jest.mock('../../hooks/usePatternChartGeneration', () => ({ usePatternChartGeneration: jest.fn() }));
jest.mock('../../identity/guestIdentity', () => ({ useIdentityStore: jest.fn() }));
const mockDeleteOffline = jest.fn().mockResolvedValue(undefined);
jest.mock('../../session-preparation', () => ({ deleteOfflinePatternFile: (id: string) => mockDeleteOffline(id) }));
jest.mock('../../hooks/useLocalArtifactChecksum', () => ({ useLocalArtifactChecksum: jest.fn() }));
jest.mock('../../api/apiFetch', () => ({ apiFetch: jest.fn() }));

const access = usePatternChartAccess as jest.Mock;
const purchase = usePurchasePatternChart as jest.Mock;
const generation = usePatternChartGeneration as jest.Mock;
const identity = useIdentityStore as unknown as jest.Mock;

function setIdentity(isAuthenticated: boolean, isAccount: boolean): void {
  identity.mockImplementation((selector: (s: { isAuthenticated: boolean; isAccount: boolean }) => unknown) =>
    selector({ isAuthenticated, isAccount }));
}

function texts(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
}

function buttons(renderer: TestRenderer.ReactTestRenderer): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAllByType(Button);
}

async function render(props: Partial<React.ComponentProps<typeof PatternChartSection>> = {}) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<PatternChartSection patternId="p" variant="detail" isOfficial canStart {...props} />);
  });
  return renderer;
}

describe('PatternChartSection', () => {
  const generate = jest.fn();
  const mutateAsync = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    setIdentity(true, true);
    (useLocalArtifactChecksum as jest.Mock).mockReturnValue(null);
    access.mockReturnValue({ isLoading: false, isError: false, data: { status: 'purchasable', price: 40, availability: 'available' }, refetch: jest.fn() });
    purchase.mockReturnValue({ isPending: false, mutateAsync });
    generation.mockReturnValue({ state: { phase: 'idle' }, generate });
  });

  it('renders nothing for a Community or Personal Pattern', async () => {
    const renderer = await render({ isOfficial: false });
    expect(renderer.toJSON()).toBeNull();
  });

  it('renders nothing when no identity exists', async () => {
    setIdentity(false, false);
    expect((await render()).toJSON()).toBeNull();
  });

  it('shows a sign-in prompt to a Guest on an Official detail screen and routes to sign-in', async () => {
    setIdentity(true, false);
    const renderer = await render();
    expect(texts(renderer)).toContain('Sign in to get a printable chart of this pattern.');
    await act(async () => {
      buttons(renderer)[0].props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/(settings)/sign-in');
  });

  it('hides the guest prompt on compact surfaces where Official status is unknown', async () => {
    setIdentity(true, false);
    expect((await render({ variant: 'compact', isOfficial: undefined })).toJSON()).toBeNull();
  });

  it('shows loading while access is checked', async () => {
    access.mockReturnValue({ isLoading: true, isError: false, data: undefined, refetch: jest.fn() });
    expect(texts(await render())).toContain('Checking chart access…');
  });

  it('shows an error with a retry that refetches', async () => {
    const refetch = jest.fn();
    access.mockReturnValue({ isLoading: false, isError: true, data: undefined, refetch });
    const renderer = await render();
    expect(texts(renderer)).toContain('Could not check chart access. Check your connection and try again.');
    await act(async () => {
      buttons(renderer)[0].props.onPress();
    });
    expect(refetch).toHaveBeenCalled();
  });

  it('renders nothing when the server says the pattern is ineligible', async () => {
    access.mockReturnValue({ isLoading: false, isError: false, data: { status: 'ineligible' }, refetch: jest.fn() });
    expect((await render()).toJSON()).toBeNull();
  });

  it('offers the purchase with the price and free-if-completed copy, sending the expected price', async () => {
    mutateAsync.mockResolvedValue({});
    const renderer = await render();
    expect(texts(renderer)).toEqual(expect.arrayContaining(['Get chart for 40 Coin', 'Free when you complete this pattern.']));
    await act(async () => {
      buttons(renderer)[0].props.onPress();
    });
    expect(mutateAsync).toHaveBeenCalledWith({ patternId: 'p', expectedPrice: 40 });
  });

  it('does not sell the chart before the player can start the pattern, or on compact surfaces', async () => {
    expect((await render({ canStart: false })).toJSON()).toBeNull();
    expect((await render({ variant: 'compact' })).toJSON()).toBeNull();
  });

  it('shows the shortfall and a coins button when the balance is too low', async () => {
    mutateAsync.mockRejectedValue(mapPatternChartError(409, { code: 'insufficient_balance', price: 40, balance: 15 }));
    const renderer = await render();
    await act(async () => {
      buttons(renderer)[0].props.onPress();
    });
    expect(texts(renderer)).toContain('You need 25 more Coin for this chart.');
  });

  it('shows the new price when it changed', async () => {
    mutateAsync.mockRejectedValue(mapPatternChartError(409, { code: 'pattern_chart_price_changed', price: 60 }));
    const renderer = await render();
    await act(async () => {
      buttons(renderer)[0].props.onPress();
    });
    expect(texts(renderer)).toContain('The chart price changed to 60 Coin. Review it and try again.');
  });

  it('generates from in-memory pattern data when entitled', async () => {
    access.mockReturnValue({ isLoading: false, isError: false, data: { status: 'entitled', price: 40, availability: 'available' }, refetch: jest.fn() });
    const pattern = { schemaVersion: 1, width: 1, height: 1, palette: [], grid: new Uint8Array(1) };
    const renderer = await render({ variant: 'compact', pattern, isOfficial: undefined });
    expect(texts(renderer)).toContain('Generate chart');
    await act(async () => {
      buttons(renderer)[0].props.onPress();
    });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ patternId: 'p', pattern, dialogTitle: 'Share chart' }));
  });

  it('reads Regenerate in history and surfaces a generation failure', async () => {
    access.mockReturnValue({ isLoading: false, isError: false, data: { status: 'entitled', price: 40, availability: 'available' }, refetch: jest.fn() });
    generation.mockReturnValue({ state: { phase: 'error', error: mapPatternChartError(410, { code: 'pattern_unavailable' }) }, generate });
    const renderer = await render({ variant: 'compact', regenerate: true });
    expect(texts(renderer)).toEqual(expect.arrayContaining(['Regenerate chart', 'This chart is no longer available.']));
  });

  it('shows progress while generating', async () => {
    access.mockReturnValue({ isLoading: false, isError: false, data: { status: 'entitled', price: 40, availability: 'available' }, refetch: jest.fn() });
    generation.mockReturnValue({ state: { phase: 'generating' }, generate });
    const renderer = await render({ variant: 'compact' });
    expect(buttons(renderer)[0].props).toMatchObject({ loading: true, disabled: true, title: 'Generating chart…' });
  });

  it('Safety Removal hides Generate on every surface and deletes the on-device copy', async () => {
    access.mockReturnValue({ isLoading: false, isError: false, data: { status: 'removed' }, refetch: jest.fn() });
    const pattern = { schemaVersion: 1, width: 1, height: 1, palette: [], grid: new Uint8Array(1) };
    for (const props of [{}, { variant: 'compact' as const, pattern, locallyCompleted: true }, { variant: 'compact' as const, localChecksum: 'c', regenerate: true, locallyCompleted: true }]) {
      mockDeleteOffline.mockClear();
      expect((await render(props)).toJSON()).toBeNull();
      expect(mockDeleteOffline).toHaveBeenCalledWith('p');
    }
  });

  it('hides Generate when the generation itself learns the pattern was removed', async () => {
    access.mockReturnValue({ isLoading: false, isError: false, data: { status: 'entitled', price: 40, availability: 'available' }, refetch: jest.fn() });
    generation.mockReturnValue({ state: { phase: 'error', error: mapPatternChartError(410, { code: 'pattern_removed' }) }, generate });
    expect((await render({ variant: 'compact' })).toJSON()).toBeNull();
    expect(mockDeleteOffline).toHaveBeenCalledWith('p');
  });

  it('Catalog Withdrawal hides Buy, and offers Generate only from local data without fetching', async () => {
    access.mockReturnValue({ isLoading: false, isError: false, data: { status: 'purchasable', price: 40, availability: 'withdrawn' }, refetch: jest.fn() });
    expect((await render()).toJSON()).toBeNull();

    access.mockReturnValue({ isLoading: false, isError: false, data: { status: 'entitled', price: 40, availability: 'withdrawn' }, refetch: jest.fn() });
    expect((await render()).toJSON()).toBeNull();

    (useLocalArtifactChecksum as jest.Mock).mockReturnValue('local-checksum');
    const renderer = await render();
    await act(async () => {
      buttons(renderer)[0].props.onPress();
    });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ allowRemoteFetch: false, localChecksum: 'local-checksum' }));
  });

  it('a local completion shows Generate at once while loading or offline, and still hides for a Guest', async () => {
    const pattern = { schemaVersion: 1, width: 1, height: 1, palette: [], grid: new Uint8Array(1) };
    const props = { variant: 'compact' as const, isOfficial: undefined, pattern, locallyCompleted: true };
    for (const state of [{ isLoading: true, isError: false, data: undefined }, { isLoading: false, isError: true, data: undefined }]) {
      access.mockReturnValue({ ...state, refetch: jest.fn() });
      const renderer = await render(props);
      expect(texts(renderer)).toContain('Generate chart');
      await act(async () => {
        buttons(renderer)[0].props.onPress();
      });
      expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ pattern, allowRemoteFetch: false }));
    }
    setIdentity(true, false);
    expect((await render(props)).toJSON()).toBeNull();
  });
});
