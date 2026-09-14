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
// A distinct id per call (not a constant) so the "same Support Reference
// across rerenders" assertion below is meaningful only because of the
// production dedup logic, not because the mock always returns one value.
let mockEventIdCounter = 0;

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
    captureMessage: jest.fn(() => {
      mockEventIdCounter += 1;
      return mockEventIdCounter.toString(16).padStart(32, '0');
    }),
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
    const eventId = (Sentry.captureMessage as jest.Mock).mock.results[0].value as string;
    expect(lastText).toContain(`Support Reference: SW-${eventId.toUpperCase()}`);

    act(() => {
      testRenderer!.unmount();
    });
  });

  it('captures a second event only for a genuinely different error object', () => {
    const errorA = new CatalogApiError(503, 'Catalog request failed with status 503', null);
    const errorB = new CatalogApiError(503, 'Catalog request failed with status 503', null);

    let rendererA: TestRenderer.ReactTestRenderer;
    let rendererB: TestRenderer.ReactTestRenderer;
    act(() => {
      rendererA = TestRenderer.create(<RenderedSectionError error={errorA} />);
    });
    act(() => {
      rendererB = TestRenderer.create(<RenderedSectionError error={errorB} />);
    });

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);

    act(() => {
      rendererA!.unmount();
      rendererB!.unmount();
    });
  });
});
