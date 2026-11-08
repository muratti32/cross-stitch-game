import fs from 'fs';
import path from 'path';
import { getRoutes } from 'expo-router/build/getRoutes';
import { getReactNavigationConfig } from 'expo-router/build/getReactNavigationConfig';
import { getStateFromPath } from 'expo-router/build/fork/getStateFromPath';
import { inboundPatternPath } from '../inboundPatternPath';
import { catalogShareLink } from '../catalogShareLink';

jest.mock('expo-router/build/react-navigation/native', () => ({
  ...jest.requireActual('expo-router/build/react-navigation/native'),
  validatePathConfig: () => undefined,
}));

const ID = '7f2a4f0e-9f27-4a57-9d1b-3a6f2e0f5c11';

describe('inboundPatternPath', () => {
  it.each([
    `https://stitchwish.avkdesign.net/pattern/${ID}`,
    `https://stitchwish.avkdesign.net/pattern/${ID}/?utm=1`,
    `stitchwish://catalog/pattern/${ID}`,
    `/pattern/${ID}`,
    `/catalog/pattern/${ID.toUpperCase()}`,
  ])('opens catalog detail for %s', (url) => {
    expect(inboundPatternPath(url)).toBe(`/(tabs)/(catalog)/${ID}`);
  });

  it('routes a non-UUID id to the unavailable segment without carrying the raw id', () => {
    expect(inboundPatternPath('https://stitchwish.avkdesign.net/pattern/not-an-id')).toBe(
      '/(tabs)/(catalog)/unavailable',
    );
    expect(inboundPatternPath('/pattern/..%2Fx')).toBe('/(tabs)/(catalog)/unavailable');
  });

  it('leaves other URLs and profile links alone', () => {
    expect(inboundPatternPath(`https://stitchwish.avkdesign.net/profile/${ID}`)).toBeNull();
    expect(inboundPatternPath('/')).toBeNull();
    expect(inboundPatternPath('stitchwish://')).toBeNull();
  });

  it('resolves to the catalog detail route in the shipped route tree', () => {
    const dir = path.join(__dirname, '../../../app');
    const walk = (d: string, base = ''): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const rel = base ? `${base}/${e.name}` : e.name;
        return e.isDirectory() ? walk(path.join(d, e.name), rel) : [`./${rel}`];
      });
    const context = (() => ({ default: () => null })) as unknown as Parameters<typeof getRoutes>[0];
    (context as unknown as { keys: () => string[] }).keys = () => walk(dir);
    const config = getReactNavigationConfig(getRoutes(context, { platform: 'ios' })!, false) as never;
    const state = getStateFromPath(inboundPatternPath(`/pattern/${ID}`)!, config) as {
      routes: { name: string; state?: unknown }[];
    };
    expect(JSON.stringify(state)).toContain('"name":"[id]"');
    expect(JSON.stringify(state)).toContain(ID);
  });
});

describe('catalogShareLink', () => {
  it('builds the public Universal Link from the web base URL and the pattern id only', () => {
    expect(catalogShareLink(ID)).toBe(`https://stitchwish.avkdesign.net/pattern/${ID}`);
  });
});
