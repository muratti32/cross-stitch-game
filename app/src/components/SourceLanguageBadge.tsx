import React from 'react';
import { StyleSheet, Text, View, ViewStyle, StyleProp } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Theme } from '../theme/theme';

interface SourceLanguageBadgeProps {
  /** A Community Pattern's Catalog Source Language code (e.g. 'en'), or null/undefined for an Official Pattern. */
  sourceLanguage?: string | null;
  style?: StyleProp<ViewStyle>;
}

/**
 * A small, neutral pill naming the Catalog Source Language a Community
 * Pattern's title and description were written in (ADR-0051, #162). The
 * title and description themselves are never translated - this badge is
 * the app-authored framing around them, so a Turkish-reading player
 * understands untranslated English content is a deliberate choice, not a
 * missing translation.
 *
 * Deliberately reuses the existing tag-chip visual language (border,
 * card background, full radius, xs font) rather than the solid
 * accent-colored price-tier badge, which this app already reserves for a
 * call-to-action signal (the Pattern Unlock price) - a language label is
 * informational, not actionable.
 *
 * Renders nothing for an Official Pattern or bundled starter pattern,
 * which carry no Catalog Source Language and are never translated either
 * way.
 */
export function SourceLanguageBadge({ sourceLanguage, style }: SourceLanguageBadgeProps) {
  const { t } = useTranslation('catalog');

  if (!sourceLanguage) {
    return null;
  }

  const code = sourceLanguage.toUpperCase();
  const languageName = t(`sourceLanguage.names.${sourceLanguage.toLowerCase()}`, {
    defaultValue: code,
  });

  return (
    <View
      style={[styles.badge, style]}
      accessible
      accessibilityLabel={t('sourceLanguage.accessibilityLabel', { language: languageName })}
    >
      <Text style={styles.badgeText} allowFontScaling>
        {code}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 2,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.full,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  badgeText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textSecondary,
    letterSpacing: 0.5,
  },
});
