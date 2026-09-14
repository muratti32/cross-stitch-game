/**
 * #249 render-path regression: many catalog screens call
 * `presentCatalogError` (which delegates to `localizeServerError`) directly
 * in a component's render body - see `SectionError` in
 * `app/(tabs)/(catalog)/index.tsx`. Before #249, every re-render of the same
 * unresolved query error minted a new Sentry event and a new player-visible
 * Support Reference. This renders a small component that calls
 * `presentCatalogError` in its body, rerenders it with the *same* Error
 * object (exactly what a re-rendering query error state does), and asserts
 * the capture and the Support Reference both stay stable.
 */
jest.mock('@sentry/react-native', () => {
  const scope = {
    setContext: jest.fn(),
    setFingerprint: jest.fn(),
    setLevel: jest.fn(),
    setTag: jest.fn(),
  };
  return {
    __scope: scope,
    addBreadcrumb: jest.fn(),
    captureMessage: jest.fn(() => '0123456789abcdef0123456789abcdef'),
    withScope: jest.fn((callback) => callback(scope)),
  };
});

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { CatalogApiError, presentCatalogError } from '../catalog';

function RenderedSectionError({ error }: { error: unknown }) {
  const presentation = presentCatalogError(error, {
    genericTitle: 'Section unavailable',
    title: 'Section unavailable',
    body: 'Could not load this section.',
  });
  return <Text>{presentation.body}</Text>;
}

describe('presentCatalogError render-path capture (#249)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('captures exactly one Sentry event across multiple renders of the same error object', () => {
    const error = new CatalogApiError(503, 'Catalog request failed with status 503', null);

    let testRenderer: TestRenderer.ReactTestRenderer;
    act(() => {
      testRenderer = TestRenderer.create(<RenderedSectionError error={error} />);
    });
    const firstText = testRenderer!.root.findByType(Text).props.children;

    // Simulate re-renders of the same unresolved query error (e.g. a parent
    // state change, or React Query re-delivering the same error object).
    act(() => {
      testRenderer!.update(<RenderedSectionError error={error} />);
    });
    act(() => {
      testRenderer!.update(<RenderedSectionError error={error} />);
    });
    const lastText = testRenderer!.root.findByType(Text).props.children;

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(lastText).toBe(firstText);
    expect(lastText).toContain('Support Reference: SW-0123456789ABCDEF0123456789ABCDEF');
  });

  it('captures a second event only for a genuinely different error object', () => {
    const errorA = new CatalogApiError(503, 'Catalog request failed with status 503', null);
    const errorB = new CatalogApiError(503, 'Catalog request failed with status 503', null);

    act(() => {
      TestRenderer.create(<RenderedSectionError error={errorA} />);
    });
    act(() => {
      TestRenderer.create(<RenderedSectionError error={errorB} />);
    });

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
  });
});
