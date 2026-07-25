import { requireOptionalNativeModule } from 'expo';
import { getThermalState, getDeviceProfile, isThermalSupported } from '../src/index';

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
  });

  describe('when native module is present', () => {
    const mockNativeModule = {
      getThermalState: jest.fn(),
      getDeviceProfile: jest.fn(),
      isThermalSupported: jest.fn(),
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
  });
});
