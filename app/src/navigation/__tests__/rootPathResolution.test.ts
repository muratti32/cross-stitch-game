import fs from 'fs';
import path from 'path';
import { getRoutes } from 'expo-router/build/getRoutes';
import { getReactNavigationConfig } from 'expo-router/build/getReactNavigationConfig';
import { getStateFromPath } from 'expo-router/build/fork/getStateFromPath';

// The linking config carries expo-router's own `_route` metadata, which React
// Navigation's stock validator rejects. expo-router skips the validator in the
// app; this test has to do the same to reach the resolution logic under test.
jest.mock('expo-router/build/react-navigation/native', () => ({
  ...jest.requireActual('expo-router/build/react-navigation/native'),
  validatePathConfig: () => undefined,
}));

const APP_DIRECTORY = path.join(__dirname, '../../../app');

function routeFiles(directory: string, base = ''): string[] {
  let files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files = files.concat(routeFiles(path.join(directory, entry.name), relative));
    } else if (/\.[jt]sx?$/.test(entry.name)) {
      files.push(`./${relative}`);
    }
  }
  return files;
}

/**
 * The route tree only depends on a layout's `unstable_settings`, so they are
 * read out of the shipped source instead of importing the module — importing a
 * layout would pull in the whole native component tree for no added coverage.
 */
function layoutSettings(key: string): Record<string, string> | undefined {
  const source = fs.readFileSync(path.join(APP_DIRECTORY, key), 'utf8');
  const declaration = source.match(/unstable_settings\s*=\s*\{([^}]*)\}/);
  if (!declaration) return undefined;
  const settings: Record<string, string> = {};
  for (const [, key_, value] of declaration[1].matchAll(
    /(anchor|initialRouteName)\s*:\s*'([^']+)'/g,
  )) {
    settings[key_] = value;
  }
  return settings;
}

/** Mirrors the Metro `require.context` expo-router builds the route tree from. */
function createRouteContext() {
  const context = (key: string) => {
    const module: Record<string, unknown> = { default: () => null };
    if (key.endsWith('_layout.tsx')) {
      const settings = layoutSettings(key);
      if (settings) module.unstable_settings = settings;
    }
    return module;
  };
  context.keys = () => routeFiles(APP_DIRECTORY);
  return context as unknown as Parameters<typeof getRoutes>[0];
}

/** The focused leaf of a navigation state, which is the screen the player sees. */
function focusedRouteNames(state: unknown): string[] {
  const names: string[] = [];
  let current = state as { index?: number; routes?: { name: string; state?: unknown }[] };
  while (current?.routes?.length) {
    const route = current.routes[current.index ?? current.routes.length - 1];
    names.push(route.name);
    current = route.state as typeof current;
  }
  return names;
}

describe('cold-start URL resolution', () => {
  const routes = getRoutes(createRouteContext(), { platform: 'ios' });
  const config = getReactNavigationConfig(routes!, false) as never;

  // Regression: `(play)`'s `anchor` (#91) made "/" resolve to the Stitch tab, so
  // a freshly installed app opened on the session list instead of Catalog.
  it('opens the Catalog tab for the "/" launch URL', () => {
    expect(focusedRouteNames(getStateFromPath('/', config))).toEqual([
      '(tabs)',
      '(catalog)',
      'index',
    ]);
  });

  it('keeps an explicit Stitch tab link on the session list', () => {
    expect(focusedRouteNames(getStateFromPath('/(tabs)/(play)', config))).toEqual([
      '(tabs)',
      '(play)',
      'index',
    ]);
  });
});
