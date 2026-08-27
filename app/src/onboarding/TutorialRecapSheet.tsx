import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Theme } from '../theme/theme';

interface Props {
  readonly visible: boolean;
  readonly onContinue: () => void;
  readonly onBrowsePatterns: () => void;
}

export function TutorialRecapSheet({ visible, onContinue, onBrowsePatterns }: Props) {
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onContinue}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onContinue} accessibilityLabel="Continue stitching" />
        <View style={styles.sheet} accessibilityRole="summary">
          <Text style={styles.title} allowFontScaling>You've got it</Text>
          <Text style={styles.line} allowFontScaling>Match the numbers to place each stitch.</Text>
          <Text style={styles.line} allowFontScaling>Drag across matching cells to sweep.</Text>
          <Text style={styles.line} allowFontScaling>Pinch to zoom when you need a closer look.</Text>
          <Text style={styles.line} allowFontScaling>Undo and the locator are always free.</Text>
          <Button title="Continue stitching" onPress={onContinue} variant="primary" style={styles.action} />
          <Button title="Browse patterns" onPress={onBrowsePatterns} variant="secondary" style={styles.action} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.35)', justifyContent: 'flex-end' },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: Theme.colors.card,
    borderTopLeftRadius: Theme.radii.xl,
    borderTopRightRadius: Theme.radii.xl,
    padding: Theme.spacing.lg,
  },
  title: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.xl, fontWeight: Theme.typography.weights.bold, marginBottom: Theme.spacing.md },
  line: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.sm, lineHeight: 20, marginBottom: Theme.spacing.xs },
  action: { marginTop: Theme.spacing.md },
});
