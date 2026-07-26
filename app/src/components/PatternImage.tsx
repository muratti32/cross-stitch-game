import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, type ImageStyle, StyleSheet, type StyleProp, View } from 'react-native';

import { selectPatternImage, type PatternImageAssets, type PatternSurfaceVariant } from '../pattern-assets';
import { Theme } from '../theme/theme';
import { CachedImage } from './CachedImage';

interface PatternImageProps {
  assets: PatternImageAssets;
  variant: PatternSurfaceVariant;
  style?: StyleProp<ImageStyle>;
  /** Locally bundled fallback (Starter Patterns ship no remote urls). */
  localAsset?: number;
  /** Bundled browsing-variant Pattern Thumbnail. */
  localThumbnailAsset?: number;
  accessibilityLabel?: string;
}

export function PatternImage({
  assets,
  variant,
  style,
  localAsset,
  localThumbnailAsset,
  accessibilityLabel,
}: PatternImageProps) {
  const selection = selectPatternImage(assets, variant);
  const fallbackAsset = variant === 'browsing' && localThumbnailAsset !== undefined
    ? localThumbnailAsset
    : localAsset;

  return (
    <View
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
      style={[styles.backdrop, style]}
    >
      {selection.kind === 'none' ? (
        fallbackAsset === undefined ? (
          <View style={styles.placeholder}>
            <Ionicons name="image-outline" size={32} color={Theme.colors.textSecondary} />
          </View>
        ) : (
          <Image source={fallbackAsset} style={styles.image} />
        )
      ) : (
        <CachedImage uri={selection.url} style={styles.image} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Opaque so transparent Pattern Preview cells stay legible under a dark theme too.
  backdrop: {
    backgroundColor: Theme.colors.patternImageBackdrop,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
});
