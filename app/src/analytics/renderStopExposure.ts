import { useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import * as Application from 'expo-application';

import { Config } from '../config';
import {
  getDeviceProfile,
  getDeviceRenderingProfile,
} from '../../modules/perf-thermal';
import { captureGameplayEvent } from './gameplayEvents';
import type {
  RenderStopExposurePayload,
} from './schema';

/**
 * Records one privacy-safe exposure observation. The caller is responsible for
 * gating this to a visible production Android Stitching Session canvas.
 */
export function recordRenderStopExposure(): void {
  const androidApi = Number(Platform.Version);
  if (!Number.isInteger(androidApi) || androidApi <= 0) return;

  const appVersion = Application.nativeApplicationVersion;
  const buildVersion = Application.nativeBuildVersion;
  // Without both native values, the observation cannot belong to a unique release window.
  if (!appVersion || !buildVersion) return;

  const release = `${appVersion}+${buildVersion}`;
  const profile = getDeviceProfile();
  const payload: RenderStopExposurePayload = {
    release,
    android_api: androidApi,
    device_rendering_profile: getDeviceRenderingProfile(profile),
  };

  // Observability must never delay or fail a local stitching transition.
  void captureGameplayEvent('render_stop_exposure', payload);
}

/**
 * Watches the OS lifecycle only while the actual Stitching Session canvas is
 * rendered. AppState can emit active -> inactive -> background, so updating the
 * previous state before recording ensures one event per active-leaving edge.
 */
export function useRenderStopExposure(
  options: {
    canvasVisible: boolean;
    screenFocused: boolean;
  },
): void {
  const { canvasVisible, screenFocused } = options;
  const previousStateRef = useRef<AppStateStatus>(AppState.currentState);
  const leftActiveRef = useRef(false);

  useEffect(() => {
    if (
      !canvasVisible ||
      !screenFocused ||
      Config.sentry.environment !== 'production' ||
      Platform.OS !== 'android'
    ) return undefined;

    previousStateRef.current = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = previousStateRef.current;
      previousStateRef.current = nextState;

      if (nextState === 'active') {
        leftActiveRef.current = false;
        return;
      }
      if (previousState === 'active') leftActiveRef.current = true;
      if (nextState === 'background' && leftActiveRef.current) {
        leftActiveRef.current = false;
        recordRenderStopExposure();
      }
    });

    return () => subscription.remove();
  }, [canvasVisible, screenFocused]);
}
