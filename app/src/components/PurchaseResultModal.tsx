import React, { useEffect } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme/theme';
import { Card } from './Card';
import { Button } from './Button';

// The purchase lifecycle has four observable outcomes. `pending` claims no
// value, `success` is the only variant allowed to state a granted quantity,
// `failed` carries the reason, and `info` is Purchase Reconciliation Pending —
// a non-failure state that never asserts the store transaction failed.
export type PurchaseResultVariant = 'pending' | 'success' | 'failed' | 'info';

interface Props {
  visible: boolean;
  variant: PurchaseResultVariant;
  title: string;
  body: string;
  detail?: string | null;
  onDismiss: () => void;
}

interface VariantConfig {
  readonly iconName: React.ComponentProps<typeof Ionicons>['name'];
  readonly iconColor: string;
  readonly buttonLabel: string;
}

const VARIANTS: Record<PurchaseResultVariant, VariantConfig> = {
  pending: {
    iconName: 'time-outline',
    iconColor: Theme.colors.warning,
    buttonLabel: 'Got it',
  },
  success: {
    iconName: 'checkmark-circle-outline',
    iconColor: Theme.colors.success,
    buttonLabel: 'Great',
  },
  failed: {
    iconName: 'close-circle-outline',
    iconColor: Theme.colors.error,
    buttonLabel: 'Close',
  },
  info: {
    iconName: 'information-circle-outline',
    iconColor: Theme.colors.accentTeal,
    buttonLabel: 'Got it',
  },
};

const SPRING_CONFIG = { damping: 12, stiffness: 180, mass: 0.7 };

export function PurchaseResultModal({
  visible,
  variant,
  title,
  body,
  detail,
  onDismiss,
}: Props) {
  const config = VARIANTS[variant];
  const isSuccess = variant === 'success';
  const iconScale = useSharedValue(1);

  useEffect(() => {
    if (!isSuccess) return;
    if (!visible) {
      iconScale.value = 0;
      return;
    }
    iconScale.value = 0;
    iconScale.value = withSpring(1, SPRING_CONFIG);
  }, [iconScale, isSuccess, visible]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  const icon = <Ionicons name={config.iconName} size={48} color={config.iconColor} />;

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay} testID="purchase-result-modal">
        <Card style={styles.card}>
          <Pressable
            style={styles.closeButton}
            onPress={onDismiss}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={24} color={Theme.colors.textSecondary} />
          </Pressable>

          {/* Only the success icon animates; every other variant relies on the
              modal's own fade. */}
          {isSuccess ? (
            <Animated.View style={[styles.icon, iconStyle]}>{icon}</Animated.View>
          ) : (
            <View style={styles.icon}>{icon}</View>
          )}

          <Text style={styles.title}>{title}</Text>

          <Text style={[styles.body, detail ? styles.bodyWithDetail : null]}>{body}</Text>

          {detail ? (
            <View style={styles.detail}>
              <Text selectable style={styles.detailText}>{detail}</Text>
            </View>
          ) : null}

          <Button
            title={config.buttonLabel}
            onPress={onDismiss}
            variant="primary"
            style={styles.button}
          />
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Theme.spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    position: 'relative',
    alignItems: 'center',
    paddingTop: Theme.spacing.xl,
    paddingBottom: Theme.spacing.xl,
    paddingHorizontal: Theme.spacing.lg,
  },
  closeButton: {
    position: 'absolute',
    top: Theme.spacing.md,
    right: Theme.spacing.md,
    zIndex: 10,
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Theme.spacing.sm,
    marginBottom: Theme.spacing.md,
  },
  title: {
    fontSize: Theme.typography.sizes.xl,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    textAlign: 'center',
    marginBottom: Theme.spacing.md,
  },
  body: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Theme.spacing.xl,
  },
  bodyWithDetail: {
    marginBottom: Theme.spacing.md,
  },
  detail: {
    alignSelf: 'stretch',
    backgroundColor: Theme.colors.background,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.sm,
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.xl,
  },
  detailText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
  },
  button: {
    width: '100%',
  },
});
