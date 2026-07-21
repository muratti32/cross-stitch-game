import React from 'react';
import { Modal, StyleSheet, Text, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme/theme';
import { Card } from './Card';
import { Button } from './Button';

interface Props {
  visible: boolean;
  onProceed: () => void;
  onSignIn: () => void;
  onDismiss: () => void;
}

export function GuestDataRiskNotice({ visible, onProceed, onSignIn, onDismiss }: Props) {
  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <Card style={styles.card}>
          <Pressable style={styles.closeButton} onPress={onDismiss} hitSlop={12}>
            <Ionicons name="close" size={24} color={Theme.colors.textSecondary} />
          </Pressable>

          <Text style={styles.title}>Playing as Guest</Text>

          <Text style={styles.body}>
            Stitch Coin and progress live only on this device as a Guest. If the
            installation is lost, the Guest ledger and progress may be
            unrecoverable. Signing in protects your progress.
          </Text>

          <View style={styles.buttonContainer}>
            <Button
              title="Sign in to protect my Coin"
              onPress={onSignIn}
              variant="primary"
              style={styles.button}
            />
            <Button
              title="Continue as Guest"
              onPress={onProceed}
              variant="secondary"
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
