import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState, Platform } from 'react-native';
import * as Application from 'expo-application';

import { Config } from '../../config';
import { recordRenderStopExposure, useRenderStopExposure } from '../renderStopExposure';
import { captureGameplayEvent } from '../gameplayEvents';
import { getDeviceProfile, getDeviceRenderingProfile } from '../../../modules/perf-thermal';

jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.2.0', nativeBuildVersion: '43' }));
jest.mock('../../config', () => ({ Config: { sentry: { environment: 'production' } } }));
jest.mock('../gameplayEvents', () => ({ captureGameplayEvent: jest.fn() }));
jest.mock('../../../modules/perf-thermal', () => ({ getDeviceProfile: jest.fn(), getDeviceRenderingProfile: jest.fn() }));

const mockedCapture = captureGameplayEvent as jest.MockedFunction<typeof captureGameplayEvent>;
const mockedGetDeviceProfile = getDeviceProfile as jest.MockedFunction<typeof getDeviceProfile>;
const mockedGetDeviceRenderingProfile = getDeviceRenderingProfile as jest.MockedFunction<typeof getDeviceRenderingProfile>;
const mockedApplication = Application as { nativeApplicationVersion: string | null; nativeBuildVersion: string | null };
type State = 'active' | 'background' | 'inactive';
type AppStateListener = (state: State) => void;
const mockedAppState = AppState as unknown as { currentState: State; addEventListener: jest.Mock };
let listeners = new Set<AppStateListener>();

beforeEach(() => {
  jest.clearAllMocks();
  listeners = new Set();
  mockedAppState.currentState = 'active';
  mockedAppState.addEventListener.mockImplementation((_event: 'change', listener: AppStateListener) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  });
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  Object.defineProperty(Platform, 'Version', { configurable: true, value: 35 });
  mockedApplication.nativeApplicationVersion = '1.2.0';
  mockedApplication.nativeBuildVersion = '43';
  Config.sentry.environment = 'production';
  mockedGetDeviceProfile.mockReturnValue({ platform: 'android', osVersion: '15', model: 'test-device', totalMemoryBytes: 2.9 * 1024 * 1024 * 1024, isEmulator: false });
  mockedGetDeviceRenderingProfile.mockReturnValue('low');
});

function setAppState(state: State): void {
  mockedAppState.currentState = state;
  listeners.forEach((listener) => listener(state));
}

async function mount(options: { canvasVisible?: boolean; screenFocused?: boolean } = {}): Promise<void> {
  function Harness(): null {
    useRenderStopExposure({ canvasVisible: options.canvasVisible ?? true, screenFocused: options.screenFocused ?? true });
    return null;
  }
  await act(async () => { TestRenderer.create(React.createElement(Harness)); });
}

describe('Render-Stop Exposure telemetry', () => {
  it('builds release from expo-application and records the exact privacy-safe payload', () => {
    recordRenderStopExposure();
    expect(mockedCapture).toHaveBeenCalledWith('render_stop_exposure', { release: '1.2.0+43', android_api: 35, device_rendering_profile: 'low' });
    const payload = mockedCapture.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['android_api', 'device_rendering_profile', 'release']);
  });

  it('does not emit when native build version is missing', () => {
    mockedApplication.nativeBuildVersion = null;
    recordRenderStopExposure();
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it('does not emit when environment is not production', async () => {
    Config.sentry.environment = 'staging';
    await mount();
    act(() => setAppState('background'));
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it('does not emit on iOS', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    await mount();
    act(() => setAppState('background'));
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it('emits for two separate background cycles', async () => {
    await mount();
    act(() => { setAppState('background'); setAppState('active'); setAppState('background'); });
    expect(mockedCapture).toHaveBeenCalledTimes(2);
  });

  it('emits once for active -> inactive -> background', async () => {
    await mount();
    act(() => { setAppState('inactive'); setAppState('background'); });
    expect(mockedCapture).toHaveBeenCalledTimes(1);
  });

  it.each([{ canvasVisible: false, screenFocused: true }, { canvasVisible: true, screenFocused: false }])(
    'does not emit unless canvas is visible and focused',
    async (options) => {
      await mount(options);
      act(() => setAppState('background'));
      expect(mockedCapture).not.toHaveBeenCalled();
    },
  );
});
