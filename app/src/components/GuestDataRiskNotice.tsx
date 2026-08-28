import React from 'react';
import { Modal, StyleSheet, Text, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Theme } from '../theme/theme';
import { Card } from './Card';
import { Button } from './Button';

interface Props {
  visible: boolean;
  onProceed: () => void;
  onSignIn: () => void;
  onDismiss: () => void;
  commerce?: boolean;
}

// Shared by the Commerce Store purchase flow (#164, in scope) and the
// catalog's Guest play risk notice (out of this slice's scope - its own
// localization ticket). Only the commerce-variant title/body and the two
// shared button labels route through commerce.json here; the non-commerce
// title/body stay the pre-translation English literal until the catalog
// slice localizes them, so this change does not plant catalog strings in
// the commerce namespace.
export function GuestDataRiskNotice({ visible, onProceed, onSignIn, onDismiss, commerce = false }: Props) {
  const { t } = useTranslation('commerce');
  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <Card style={styles.card}>
          <Pressable
            style={styles.closeButton}
            onPress={onDismiss}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('guestDataRiskNotice.closeAccessibilityLabel')}
          >
            <Ionicons name="close" size={24} color={Theme.colors.textSecondary} />
          </Pressable>

          <Text style={styles.title}>
            {commerce ? t('guestDataRiskNotice.commerceTitle') : 'Playing as Guest'}
          </Text>

          <Text style={styles.body}>
            {commerce
              ? t('guestDataRiskNotice.commerceBody')
              : 'Stitch Coin and progress live only on this device as a Guest. If the installation is lost, the Guest ledger and progress may be unrecoverable. Signing in protects your progress.'}
          </Text>

          <View style={styles.buttonContainer}>
            <Button
              title={t('guestDataRiskNotice.continueAsGuest')}
              onPress={onProceed}
              variant={commerce ? 'primary' : 'secondary'}
              style={styles.button}
            />
            <Button
              title={t('guestDataRiskNotice.signInInstead')}
              onPress={onSignIn}
              variant={commerce ? 'secondary' : 'primary'}
              style={styles.button}
            />
          </View>
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
  title: {
    fontSize: Theme.typography.sizes.xl,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    textAlign: 'center',
    marginBottom: Theme.spacing.md,
    marginTop: Theme.spacing.sm,
  },
  body: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Theme.spacing.xl,
  },
  buttonContainer: {
    gap: Theme.spacing.sm,
  },
  button: {
    width: '100%',
  },
});
