import { SCENARIOS } from '../scenarios';
import { REQUIRED_SCENARIOS } from '../budgets';

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
});
