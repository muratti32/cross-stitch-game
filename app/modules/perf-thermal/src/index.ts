import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/**
  * ADR-0031: Stitch Interaction Budget
  * Valid thermal states that report the device thermal status.
  */
export type PerfThermalState = 'nominal' | 'fair' | 'serious' | 'critical' | 'unsupported';

/**
  * ADR-0031: Stitch Interaction Budget
  * Structured device profile information.
  */
export interface PerfDeviceProfile {
  platform: 'ios' | 'android';
  osVersion: string;
  model: string;
  totalMemoryBytes: number;
  isEmulator: boolean;
}

interface NativePerfThermalModule {
  getThermalState(): string;
  getDeviceProfile(): {
    platform: string;
    osVersion: string;
    model: string;
    totalMemoryBytes: number;
    isEmulator: boolean;
  };
  isThermalSupported(): boolean;
}

let cachedNativeModule: NativePerfThermalModule | null = null;
let isNativeModuleChecked = false;

function getNativeModule(): NativePerfThermalModule | null {
  // In test environment, bypass cache to allow dynamic mocking in Jest.
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test') {
    return requireOptionalNativeModule<NativePerfThermalModule>('PerfThermal');
  }

  if (!isNativeModuleChecked) {
    cachedNativeModule = requireOptionalNativeModule<NativePerfThermalModule>('PerfThermal');
    isNativeModuleChecked = true;
  }
  return cachedNativeModule;
}

/**
 * ADR-0031: Stitch Interaction Budget
 * Retrieves the current thermal state of the device synchronously.
 * Falls back to 'unsupported' if the native module is not available or errors.
 *
 * @returns {PerfThermalState} The current thermal state.
 */
export function getThermalState(): PerfThermalState {
  const module = getNativeModule();
  if (!module) {
    return 'unsupported';
  }
  try {
    const state = module.getThermalState();
    if (state === 'nominal' || state === 'fair' || state === 'serious' || state === 'critical' || state === 'unsupported') {
      return state;
    }
    return 'unsupported';
  } catch {
    return 'unsupported';
  }
}

/**
 * ADR-0031: Stitch Interaction Budget
 * Retrieves the device profile details synchronously.
 * Falls back to a best-effort profile using react-native Platform if the native module is unavailable or errors.
 *
 * @returns {PerfDeviceProfile} The device profile metadata.
 */
export function getDeviceProfile(): PerfDeviceProfile {
  const module = getNativeModule();
  if (!module) {
    return getFallbackDeviceProfile();
  }
  try {
    const profile = module.getDeviceProfile();
    if (profile && typeof profile === 'object') {
      const platform: 'ios' | 'android' = profile.platform === 'ios' ? 'ios' : 'android';
      return {
        platform,
        osVersion: String(profile.osVersion || ''),
        model: String(profile.model || ''),
        totalMemoryBytes: Number(profile.totalMemoryBytes || 0),
        isEmulator: Boolean(profile.isEmulator),
      };
    }
    return getFallbackDeviceProfile();
  } catch {
    return getFallbackDeviceProfile();
  }
}

/**
 * ADR-0031: Stitch Interaction Budget
 * Checks if thermal state reporting is natively supported on this device.
 * Returns false if the native module is unavailable or errors.
 *
 * @returns {boolean} True if thermal state is supported, false otherwise.
 */
export function isThermalSupported(): boolean {
  const module = getNativeModule();
  if (!module) {
    return false;
  }
  try {
    return Boolean(module.isThermalSupported());
  } catch {
    return false;
  }
}

/**
 * Generates a fallback device profile based on react-native Platform values.
 *
 * @returns {PerfDeviceProfile} The fallback profile.
 */
function getFallbackDeviceProfile(): PerfDeviceProfile {
  const platform: 'ios' | 'android' = Platform.OS === 'android' ? 'android' : 'ios';
  
  // Extract OS version from Platform
  const osVersion = String(Platform.Version || '');
  
  // Best-effort check for emulator inside test environment or generic fallback
  let isEmulator = false;
  let model = 'unknown';

  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test') {
    isEmulator = true;
    model = 'jest-mock-device';
  }

  return {
    platform,
    osVersion,
    model,
    totalMemoryBytes: 0,
    isEmulator,
  };
}
