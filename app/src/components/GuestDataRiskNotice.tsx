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

// Shared by the Commerce Store purchase flow (#164) and the catalog's
// Guest unlock risk notice (#166). The commerce-variant title/body and the
// two shared button labels route through commerce.json; the non-commerce
// title/body route through catalog.json so this component never plants one
// feature's strings in another's namespace.
export function GuestDataRiskNotice({ visible, onProceed, onSignIn, onDismiss, commerce = false }: Props) {
  const { t } = useTranslation(['commerce', 'catalog']);
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
            accessibilityLabel={t('commerce:guestDataRiskNotice.closeAccessibilityLabel')}
          >
            <Ionicons name="close" size={24} color={Theme.colors.textSecondary} />
          </Pressable>

          <Text style={styles.title}>
            {commerce ? t('commerce:guestDataRiskNotice.commerceTitle') : t('catalog:guestDataRiskNotice.title')}
          </Text>

          <Text style={styles.body}>
            {commerce ? t('commerce:guestDataRiskNotice.commerceBody') : t('catalog:guestDataRiskNotice.body')}
          </Text>

          <View style={styles.buttonContainer}>
            <Button
              title={t('commerce:guestDataRiskNotice.continueAsGuest')}
              onPress={onProceed}
              variant={commerce ? 'primary' : 'secondary'}
              style={styles.button}
            />
            <Button
              title={t('commerce:guestDataRiskNotice.signInInstead')}
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
