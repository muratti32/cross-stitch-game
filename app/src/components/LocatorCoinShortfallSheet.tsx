import React, { useEffect, useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { formatNumber } from '@/i18n';
import { Theme } from '@/theme/theme';

import { Button } from './Button';

/**
 * What the sheet's primary action promises: a direct Stitch Coin Pack purchase,
 * or the optional registration/sign-in an Android Guest Player needs first.
 */
export type LocatorShortfallPrimaryAction = 'purchase' | 'authenticate';

interface Props {
  readonly visible: boolean;
  readonly price: number;
  readonly balance: number;
  readonly locale: string;
  readonly primaryAction: LocatorShortfallPrimaryAction;
  readonly onPrimaryAction: () => void;
  readonly onDismiss: () => void;
  /**
   * Fires once the sheet has given up the screen, so the caller can navigate
   * without a second native modal opening underneath this one. On iOS that is
   * the real post-dismissal lifecycle; Android exposes none, so it is the
   * true-to-false render edge, which leads the slide-out by its duration.
   */
  readonly onDismissed: () => void;
}

export function LocatorCoinShortfallSheet({
  visible,
  price,
  balance,
  locale,
  primaryAction,
  onPrimaryAction,
  onDismiss,
  onDismissed,
}: Props) {
  const { t } = useTranslation('play');
  const translateY = useSharedValue(0);
  const previousVisible = useRef(visible);

  useEffect(() => {
    // Reset on both edges: a swipe-dismissed sheet would otherwise slide out
    // from wherever the drag left it, and re-open at that same offset.
    translateY.value = 0;
  }, [translateY, visible]);

  useEffect(() => {
    const wasVisible = previousVisible.current;
    previousVisible.current = visible;
    // iOS exposes Modal's native post-dismiss callback. Android does not, so
    // its completed lifecycle is derived from the first true-to-false edge.
    if (Platform.OS === 'android' && wasVisible && !visible) onDismissed();
  }, [onDismissed, visible]);

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      translateY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      if (event.translationY > 80 || event.velocityY > 800) {
        runOnJS(onDismiss)();
        return;
      }
      translateY.value = withSpring(0);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const priceLabel = t('locatorShortfall.priceLabel');
  const balanceLabel = t('locatorShortfall.balanceLabel');
  const formattedPrice = formatNumber(price, locale);
  const formattedBalance = formatNumber(balance, locale);

  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onDismiss}
      onDismiss={Platform.OS === 'ios' ? onDismissed : undefined}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.dismissArea}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={t('locatorShortfall.dismissAccessibilityLabel')}
        />
        <GestureDetector gesture={panGesture}>
          <Animated.View
            style={[styles.sheet, animatedStyle]}
            testID="locator-coin-shortfall-sheet"
            accessibilityLabel={t('locatorShortfall.title')}
            accessibilityViewIsModal
          >
            <View
              style={styles.dragHandle}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <Text style={styles.title} accessibilityRole="header" allowFontScaling>
              {t('locatorShortfall.title')}
            </Text>
            <Text style={styles.body} allowFontScaling>
              {t('locatorShortfall.body')}
            </Text>
            <View
              style={styles.amountRow}
              accessible
              accessibilityLabel={`${priceLabel}: ${formattedPrice}`}
            >
              <Text style={styles.amountLabel} allowFontScaling>{priceLabel}</Text>
              <Text style={styles.amountValue} allowFontScaling>{formattedPrice}</Text>
            </View>
            <View
              style={styles.amountRow}
              accessible
              accessibilityLabel={`${balanceLabel}: ${formattedBalance}`}
            >
              <Text style={styles.amountLabel} allowFontScaling>{balanceLabel}</Text>
              <Text style={styles.amountValue} allowFontScaling>{formattedBalance}</Text>
            </View>
            <Button
              title={t(primaryAction === 'purchase'
                ? 'locatorShortfall.purchaseAction'
                : 'locatorShortfall.authAction')}
              onPress={onPrimaryAction}
              variant="primary"
              style={styles.action}
            />
            <Button
              title={t('locatorShortfall.dismissAction')}
              onPress={onDismiss}
              variant="secondary"
              style={styles.action}
            />
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'flex-end',
  },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: Theme.colors.card,
    borderTopLeftRadius: Theme.radii.xl,
    borderTopRightRadius: Theme.radii.xl,
    paddingHorizontal: Theme.spacing.lg,
    paddingBottom: Theme.spacing.xl,
  },
  dragHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: Theme.radii.full,
    backgroundColor: Theme.colors.border,
    marginTop: Theme.spacing.sm,
    marginBottom: Theme.spacing.lg,
  },
  title: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.xl,
    fontWeight: Theme.typography.weights.bold,
    marginBottom: Theme.spacing.sm,
  },
  body: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.sm,
    lineHeight: 20,
    marginBottom: Theme.spacing.lg,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  amountLabel: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.md,
  },
  amountValue: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.semibold,
  },
  action: {
    width: '100%',
    marginTop: Theme.spacing.md,
  },
});
