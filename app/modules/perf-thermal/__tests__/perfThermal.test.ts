import { requireOptionalNativeModule } from 'expo';
import {
  getThermalState,
  getDeviceProfile,
  isThermalSupported,
  getMemoryUsageAsync,
  getDeviceRenderingProfile,
  LOW_END_RAM_THRESHOLD_BYTES,
} from '../src/index';

// Mock expo module
jest.mock('expo', () => {
  const original = jest.requireActual('expo');
  return {
    ...original,
    requireOptionalNativeModule: jest.fn(),
  };
});

const mockRequireOptional = requireOptionalNativeModule as jest.Mock;

describe('perf-thermal module fallback and native mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('when native module is absent (fallback path)', () => {
    beforeEach(() => {
      mockRequireOptional.mockReturnValue(null);
    });

    it('returns unsupported for getThermalState', () => {
      const state = getThermalState();
      expect(state).toBe('unsupported');
    });

    it('returns false for isThermalSupported', () => {
      const supported = isThermalSupported();
      expect(supported).toBe(false);
    });

    it('returns a best-effort profile for getDeviceProfile', () => {
      const profile = getDeviceProfile();
      expect(profile.platform).toBe('ios'); // default platform fallback in tests is ios under Jest Expo, or whatever Platform.OS maps to
      expect(profile.osVersion).toBeDefined();
      expect(profile.model).toBe('jest-mock-device');
      expect(profile.totalMemoryBytes).toBe(0);
      expect(profile.isEmulator).toBe(true);
    });

    it('returns process memory fallback for getMemoryUsageAsync', async () => {
      const mem = await getMemoryUsageAsync();
      expect(mem).toMatchObject({ available: true, source: 'node' });
      if (mem.available) {
        expect(mem.residentBytes).toBeGreaterThan(0);
        expect(mem.footprintBytes).toBeGreaterThan(0);
        expect(mem.jsHeapBytes).toBeGreaterThan(0);
      }
    });
  });

  describe('when native module is present', () => {
    const mockNativeModule = {
      getThermalState: jest.fn(),
      getDeviceProfile: jest.fn(),
      isThermalSupported: jest.fn(),
      getMemoryFootprint: jest.fn(),
    };

    beforeEach(() => {
      mockRequireOptional.mockReturnValue(mockNativeModule);
    });

    it('passes through nominal thermal state mapping', () => {
      mockNativeModule.getThermalState.mockReturnValue('nominal');
      expect(getThermalState()).toBe('nominal');
      expect(mockNativeModule.getThermalState).toHaveBeenCalledTimes(1);
    });

    it('passes through fair thermal state mapping', () => {
      mockNativeModule.getThermalState.mockReturnValue('fair');
      expect(getThermalState()).toBe('fair');
    });

    it('passes through serious thermal state mapping', () => {
      mockNativeModule.getThermalState.mockReturnValue('serious');
      expect(getThermalState()).toBe('serious');
    });

    it('passes through critical thermal state mapping', () => {
      mockNativeModule.getThermalState.mockReturnValue('critical');
      expect(getThermalState()).toBe('critical');
    });

    it('passes through unsupported thermal state mapping', () => {
      mockNativeModule.getThermalState.mockReturnValue('unsupported');
      expect(getThermalState()).toBe('unsupported');
    });

    it('handles unexpected native thermal state returned gracefully by falling back to unsupported', () => {
      mockNativeModule.getThermalState.mockReturnValue('unknown-unexpected-state');
      expect(getThermalState()).toBe('unsupported');
    });

    it('handles native throwing in getThermalState by falling back to unsupported', () => {
      mockNativeModule.getThermalState.mockImplementation(() => {
        throw new Error('Native error');
      });
      expect(getThermalState()).toBe('unsupported');
    });

    it('passes through isThermalSupported true', () => {
      mockNativeModule.isThermalSupported.mockReturnValue(true);
      expect(isThermalSupported()).toBe(true);
      expect(mockNativeModule.isThermalSupported).toHaveBeenCalledTimes(1);
    });

    it('passes through isThermalSupported false', () => {
      mockNativeModule.isThermalSupported.mockReturnValue(false);
      expect(isThermalSupported()).toBe(false);
    });

    it('handles native throwing in isThermalSupported by returning false', () => {
      mockNativeModule.isThermalSupported.mockImplementation(() => {
        throw new Error('Native error');
      });
      expect(isThermalSupported()).toBe(false);
    });

    it('passes through getDeviceProfile values correctly', () => {
      const mockProfile = {
        platform: 'ios',
        osVersion: '17.4',
        model: 'iPhone15,2',
        totalMemoryBytes: 6000000000,
        isEmulator: false,
      };
      mockNativeModule.getDeviceProfile.mockReturnValue(mockProfile);

      const profile = getDeviceProfile();
      expect(profile).toEqual({
        platform: 'ios',
        osVersion: '17.4',
        model: 'iPhone15,2',
        totalMemoryBytes: 6000000000,
        isEmulator: false,
      });
      expect(mockNativeModule.getDeviceProfile).toHaveBeenCalledTimes(1);
    });

    it('handles partial getDeviceProfile returned from native by supplying defaults', () => {
      const mockProfile = {
        platform: 'android',
        osVersion: '14',
        model: 'Google Pixel 8',
      };
      mockNativeModule.getDeviceProfile.mockReturnValue(mockProfile);

      const profile = getDeviceProfile();
      expect(profile).toEqual({
        platform: 'android',
        osVersion: '14',
        model: 'Google Pixel 8',
        totalMemoryBytes: 0,
        isEmulator: false,
      });
    });

    it('handles native throwing in getDeviceProfile by falling back to Platform profile', () => {
      mockNativeModule.getDeviceProfile.mockImplementation(() => {
        throw new Error('Native error');
      });
      const profile = getDeviceProfile();
      expect(profile.platform).toBe('ios');
      expect(profile.model).toBe('jest-mock-device');
      expect(profile.totalMemoryBytes).toBe(0);
    });

    it('returns values from native getMemoryFootprint when present', async () => {
      mockNativeModule.getMemoryFootprint.mockResolvedValue({
        residentBytes: 150000000,
        footprintBytes: 145000000,
      });

      const mem = await getMemoryUsageAsync();
      expect(mem).toMatchObject({
        available: true,
        source: 'native',
        residentBytes: 150000000,
        footprintBytes: 145000000,
      });
    });

    it('returns unavailable when native memory read fails without Node fallback', async () => {
      mockNativeModule.getMemoryFootprint.mockRejectedValue(new Error('task_info failed'));

      await expect(getMemoryUsageAsync()).resolves.toEqual({
        available: false,
        reason: 'task_info failed',
      });
    });

    it('uses Hermes js_heapSize and returns null when no supported heap key exists', async () => {
      const runtime = globalThis as typeof globalThis & {
        HermesInternal?: { getInstrumentedStats: () => Record<string, unknown> };
      };
      runtime.HermesInternal = {
        getInstrumentedStats: jest.fn().mockReturnValue({ js_heapSize: 1234, js_allocatedBytes: 5678 }),
      };
      mockNativeModule.getMemoryFootprint.mockResolvedValue({ residentBytes: null, footprintBytes: 4321 });

      const withHeap = await getMemoryUsageAsync();
      expect(withHeap).toMatchObject({ available: true, jsHeapBytes: 1234 });

      runtime.HermesInternal.getInstrumentedStats = jest.fn().mockReturnValue({ unrelated: 5678 });
      const withoutHeap = await getMemoryUsageAsync();
      expect(withoutHeap).toMatchObject({
        available: true,
        jsHeapBytes: null,
        jsHeapUnavailableReason: 'Hermes stats report no js_heapSize or js_allocatedBytes.',
      });

      runtime.HermesInternal.getInstrumentedStats = jest.fn(() => {
        throw new Error('stats unavailable');
      });
      const heapThrows = await getMemoryUsageAsync();
      expect(heapThrows).toMatchObject({
        available: true,
        jsHeapBytes: null,
        jsHeapUnavailableReason: 'stats unavailable',
      });
      delete runtime.HermesInternal;
    });
  });

  describe('getDeviceRenderingProfile (ADR-0056)', () => {
    it('classifies constrained Android devices as low', () => {
      // Reported memory is lower than marketed RAM on the reference device.
      const tabA7LiteBytes = 2.9 * 1024 * 1024 * 1024;
      expect(getDeviceRenderingProfile({
        platform: 'android',
        totalMemoryBytes: tabA7LiteBytes,
      })).toBe('low');

      expect(getDeviceRenderingProfile({
        platform: 'android',
        totalMemoryBytes: LOW_END_RAM_THRESHOLD_BYTES,
      })).toBe('low');
    });

    it('classifies Android devices above the threshold as standard', () => {
      const fourGbBytes = 4 * 1024 * 1024 * 1024;
      expect(getDeviceRenderingProfile({
        platform: 'android',
        totalMemoryBytes: fourGbBytes,
      })).toBe('standard');
    });

    it('keeps iOS standard regardless of reported memory', () => {
      const constrainedMemoryBytes = 2.9 * 1024 * 1024 * 1024;
      expect(getDeviceRenderingProfile({
        platform: 'ios',
        totalMemoryBytes: constrainedMemoryBytes,
      })).toBe('standard');
    });

    it('defaults to standard when Android memory is 0 or unavailable', () => {
      expect(getDeviceRenderingProfile({ platform: 'android', totalMemoryBytes: 0 })).toBe('standard');
      expect(getDeviceRenderingProfile({ platform: 'android' })).toBe('standard');
    });
  });
});
