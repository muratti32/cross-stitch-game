import {
  normalizePersonalPatternTitle,
  suggestAiPatternTitle,
} from '../patternTitle';

describe('AI Personal Pattern titles', () => {
  it('suggests the base title when it is available', () => {
    expect(suggestAiPatternTitle(['A Photo Pattern'])).toBe('My AI Pattern');
  });

  it('suggests the first available numeric suffix', () => {
    expect(
      suggestAiPatternTitle([
        'My AI Pattern',
        'My AI Pattern 2',
        'My AI Pattern 4',
      ]),
    ).toBe('My AI Pattern 3');
  });

  it('matches existing titles without case or surrounding whitespace', () => {
    expect(suggestAiPatternTitle(['  my ai pattern  ', 'MY AI PATTERN 2'])).toBe(
      'My AI Pattern 3',
    );
    expect(normalizePersonalPatternTitle('  My Pattern  ')).toBe('my pattern');
  });
});
