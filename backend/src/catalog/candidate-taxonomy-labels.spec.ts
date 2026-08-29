import { CANDIDATE_APP_DISPLAY_LOCALES } from './candidate-locales.constant';
import { CANDIDATE_CATEGORY_LABELS, CANDIDATE_TAG_LABELS } from './candidate-taxonomy-labels';

describe('candidate taxonomy labels', () => {
  it('covers every candidate locale for every canonical category and tag', () => {
    for (const labels of [...Object.values(CANDIDATE_CATEGORY_LABELS), ...Object.values(CANDIDATE_TAG_LABELS)]) {
      expect(Object.keys(labels).sort()).toEqual([...CANDIDATE_APP_DISPLAY_LOCALES].sort());
    }
    expect(Object.keys(CANDIDATE_CATEGORY_LABELS)).toHaveLength(10);
    expect(Object.keys(CANDIDATE_TAG_LABELS).length).toBeGreaterThan(0);
  });
});
