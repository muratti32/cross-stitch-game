import { type SharedValue } from 'react-native-reanimated';
import { SCENARIOS, runScenario, type ScenarioContext, type ScenarioDefinition } from '../scenarios';
import { REQUIRED_SCENARIOS } from '../budgets';
import { buildLatePlayFixture } from '../fixtures';
import { RendererState } from '../../renderer/RendererState';
import { FrameSampler, LatencySampler, MemorySampler, ThermalSampler } from '../metrics';

jest.mock('../../../modules/perf-thermal', () => ({
  getMemoryUsageAsync: jest.fn().mockResolvedValue({
    available: true,
    source: 'node',
    residentBytes: 100,
    footprintBytes: 100,
    jsHeapBytes: 50,
  }),
  getThermalState: jest.fn().mockReturnValue('nominal'),
}));

function sharedValue<Value>(value: Value): SharedValue<Value> {
  return {
    value,
    get: () => value,
    set: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    modify: () => undefined,
  };
}

describe('Performance Scenarios (ADR-0031)', () => {
  test('SCENARIOS list covers REQUIRED_SCENARIOS exactly', () => {
    const scenarioIds = SCENARIOS.map((s) => s.id);
    expect(scenarioIds.length).toBe(REQUIRED_SCENARIOS.length);
    for (const requiredId of REQUIRED_SCENARIOS) {
      expect(scenarioIds).toContain(requiredId);
    }
  });

  test('scenario ids are unique', () => {
    const scenarioIds = SCENARIOS.map((s) => s.id);
    const uniqueIds = new Set(scenarioIds);
    expect(uniqueIds.size).toBe(scenarioIds.length);
  });

  test('each definition declares a valid fixture', () => {
    for (const def of SCENARIOS) {
      expect(['late-play', 'fully-completed']).toContain(def.fixture);
    }
  });

  test('runScenario samples memory for a non-memory scenario', async () => {
    const fixture = buildLatePlayFixture();
    const context: ScenarioContext = {
      rendererState: new RendererState(fixture.pattern.width, fixture.pattern.height, fixture.completed),
      pattern: fixture.pattern,
      translateX: sharedValue(0),
      translateY: sharedValue(0),
      scale: sharedValue(1),
      containerWidth: sharedValue(390),
      containerHeight: sharedValue(844),
      completedShared: sharedValue<Uint8Array>(new Uint8Array(fixture.completed)),
      activeColorIndexShared: sharedValue(0),
      frameSampler: new FrameSampler(),
      latencySampler: new LatencySampler(),
      thermalSampler: new ThermalSampler(),
      memorySampler: new MemorySampler(),
      bumpRevision: () => undefined,
      stitchCell: () => undefined,
      undoLast: () => undefined,
    };
    const definition: ScenarioDefinition = {
      id: 'pan',
      title: 'test',
      description: 'test',
      fixture: 'late-play',
      requiresOperatorAction: false,
      run: async () => undefined,
    };

    const measurement = await runScenario(definition, context);

    expect(measurement.memorySamples).toHaveLength(2);
    expect(measurement.memoryUnavailableCount).toBe(0);
  });
});
