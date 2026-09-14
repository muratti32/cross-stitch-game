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

/**
 * ADR-0056: Android totalMem reports less than marketed RAM, so a 3.25 GiB
 * reported-memory threshold covers devices marketed with up to 3 GB RAM.
 */
export type DeviceRenderingProfile = 'low' | 'standard';

export const LOW_END_RAM_THRESHOLD_BYTES = 3.25 * 1024 * 1024 * 1024;

/**
 * Measured memory footprint and heap metrics.
 */
export type PerfMemoryReading =
  | {
      available: true;
      source: 'native' | 'node';
      footprintBytes: number;
      residentBytes: number | null;
      jsHeapBytes: number | null;
      /** Set when jsHeapBytes is null, explaining why the heap could not be read. */
      jsHeapUnavailableReason?: string;
    }
  | {
      available: false;
      reason: string;
    };

interface HermesInternalLike {
  getInstrumentedStats: () => Record<string, unknown>;
}

interface PerformanceMemoryLike {
  usedJSHeapSize?: unknown;
}

interface RuntimeGlobals {
  HermesInternal?: HermesInternalLike;
  performance?: Performance & { memory?: PerformanceMemoryLike };
}

interface NativeMemoryFootprint {
  residentBytes: number | null;
  footprintBytes: number;
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
  getMemoryFootprint?: () => Promise<NativeMemoryFootprint>;
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
 * ADR-0056: Resolves the Android rendering profile from reported total memory.
 */
export function getDeviceRenderingProfile(
  profile?: Partial<PerfDeviceProfile>,
): DeviceRenderingProfile {
  const target = profile ?? getDeviceProfile();
  const platform = target.platform ?? Platform.OS;
  const totalMemoryBytes = target.totalMemoryBytes ?? 0;
  if (
    platform === 'android'
    && totalMemoryBytes > 0
    && totalMemoryBytes <= LOW_END_RAM_THRESHOLD_BYTES
  ) {
    return 'low';
  }
  return 'standard';
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

/**
 * Retrieves the current memory usage (resident, physical footprint, and JS heap).
 * Uses the native PerfThermal module if available. Node/process fallbacks are
 * used only when the native module is absent.
 *
 * @returns {Promise<PerfMemoryReading>} Current memory usage reading.
 */
export async function getMemoryUsageAsync(): Promise<PerfMemoryReading> {
  let module: NativePerfThermalModule | null;
  try {
    module = getNativeModule();
  } catch (error: unknown) {
    return { available: false, reason: errorMessage(error) };
  }

  if (module) {
    if (typeof module.getMemoryFootprint !== 'function') {
      return { available: false, reason: 'Native memory footprint API is unavailable.' };
    }
    try {
      const nativeMemory = await module.getMemoryFootprint();
      const footprintBytes = finiteNumber(nativeMemory.footprintBytes);
      const residentBytes = nullableFiniteNumber(nativeMemory.residentBytes);
      if (footprintBytes === null || residentBytes === undefined) {
        return { available: false, reason: 'Native memory footprint response is invalid.' };
      }
      return {
        available: true,
        source: 'native',
        footprintBytes,
        residentBytes,
        ...readJsHeap(),
      };
    } catch (error: unknown) {
      return { available: false, reason: errorMessage(error) };
    }
  }

  return readNodeMemory();
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableFiniteNumber(value: number | null): number | null | undefined {
  if (value === null) return null;
  return finiteNumber(value) ?? undefined;
}

interface JsHeapReading {
  jsHeapBytes: number | null;
  jsHeapUnavailableReason?: string;
}

function readJsHeap(): JsHeapReading {
  const runtime = globalThis as typeof globalThis & RuntimeGlobals;
  const hermes = runtime.HermesInternal;
  if (hermes) {
    try {
      const stats = hermes.getInstrumentedStats();
      const bytes = finiteNumber(stats.js_heapSize) ?? finiteNumber(stats.js_allocatedBytes);
      return bytes === null
        ? { jsHeapBytes: null, jsHeapUnavailableReason: 'Hermes stats report no js_heapSize or js_allocatedBytes.' }
        : { jsHeapBytes: bytes };
    } catch (error: unknown) {
      return { jsHeapBytes: null, jsHeapUnavailableReason: errorMessage(error) };
    }
  }

  const browserHeap = finiteNumber(runtime.performance?.memory?.usedJSHeapSize);
  if (browserHeap !== null) return { jsHeapBytes: browserHeap };

  if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
    try {
      return heapFromNode(process.memoryUsage().heapUsed);
    } catch (error: unknown) {
      return { jsHeapBytes: null, jsHeapUnavailableReason: errorMessage(error) };
    }
  }
  return { jsHeapBytes: null, jsHeapUnavailableReason: 'No JS heap API is available.' };
}

function heapFromNode(heapUsed: number): JsHeapReading {
  const bytes = finiteNumber(heapUsed);
  return bytes === null
    ? { jsHeapBytes: null, jsHeapUnavailableReason: 'Node memory API returned an invalid heapUsed value.' }
    : { jsHeapBytes: bytes };
}

function readNodeMemory(): PerfMemoryReading {
  if (typeof process === 'undefined' || typeof process.memoryUsage !== 'function') {
    return { available: false, reason: 'Node memory API is unavailable.' };
  }
  try {
    const memory = process.memoryUsage();
    const rssBytes = finiteNumber(memory.rss);
    if (rssBytes === null) {
      return { available: false, reason: 'Node memory API returned an invalid RSS value.' };
    }
    return {
      available: true,
      source: 'node',
      footprintBytes: rssBytes,
      residentBytes: rssBytes,
      ...heapFromNode(memory.heapUsed),
    };
  } catch (error: unknown) {
    return { available: false, reason: errorMessage(error) };
  }
}

/** Formats a byte count as mebibytes with the given number of decimals. */
export function formatBytesAsMb(bytes: number, decimals: number): string {
  return (bytes / (1024 * 1024)).toFixed(decimals);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
