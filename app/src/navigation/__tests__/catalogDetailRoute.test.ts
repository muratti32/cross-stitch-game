import { catalogDetailRoute } from '../catalogDetailRoute';

describe('catalogDetailRoute', () => {
  test('routes to the catalog detail of the pattern', () => {
    expect(catalogDetailRoute('pattern-1')).toEqual({
      pathname: '/(tabs)/(catalog)/[id]',
      params: { id: 'pattern-1' },
    });
  });
});
