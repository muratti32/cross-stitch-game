import { formatNumber, formatDate } from '../formatting';

// Deliberately not asserting on actual Intl output (platform behavior, and
// it would make this suite fail across JS engine versions - see #155's
// Testing Decisions). Instead this asserts the helpers bind to the *given*
// locale rather than a hardcoded one, which is the behavior this seam owns.
describe('formatNumber', () => {
  it('constructs Intl.NumberFormat with the given locale', () => {
    const spy = jest.spyOn(Intl, 'NumberFormat');
    formatNumber(1234.5, 'tr');
    expect(spy).toHaveBeenCalledWith('tr', undefined);
    spy.mockRestore();
  });

  it('threads through explicit Intl.NumberFormat options', () => {
    const spy = jest.spyOn(Intl, 'NumberFormat');
    formatNumber(0.42, 'en', { style: 'percent' });
    expect(spy).toHaveBeenCalledWith('en', { style: 'percent' });
    spy.mockRestore();
  });

  it('returns a string', () => {
    expect(typeof formatNumber(1234.5, 'en')).toBe('string');
  });
});

describe('formatDate', () => {
  it('constructs Intl.DateTimeFormat with the given locale', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat');
    formatDate(new Date('2026-08-27T00:00:00.000Z'), 'tr');
    expect(spy).toHaveBeenCalledWith('tr', undefined);
    spy.mockRestore();
  });

  it('threads through explicit Intl.DateTimeFormat options', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat');
    const options: Intl.DateTimeFormatOptions = { dateStyle: 'long' };
    formatDate(new Date('2026-08-27T00:00:00.000Z'), 'en', options);
    expect(spy).toHaveBeenCalledWith('en', options);
    spy.mockRestore();
  });

  it('returns a string', () => {
    expect(typeof formatDate(new Date('2026-08-27T00:00:00.000Z'), 'en')).toBe('string');
  });
});
