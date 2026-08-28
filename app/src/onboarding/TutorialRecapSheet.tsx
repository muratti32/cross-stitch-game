import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { Theme } from '../theme/theme';

interface Props {
  readonly visible: boolean;
  readonly onContinue: () => void;
  readonly onBrowsePatterns: () => void;
}

export function TutorialRecapSheet({ visible, onContinue, onBrowsePatterns }: Props) {
  const { t } = useTranslation('onboarding');
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onContinue}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onContinue} accessibilityLabel={t('recap.continue')} />
        <View style={styles.sheet} accessibilityRole="summary">
          <Text style={styles.title} allowFontScaling>{t('recap.title')}</Text>
          <Text style={styles.line} allowFontScaling>{t('recap.lines.matchNumbers')}</Text>
          <Text style={styles.line} allowFontScaling>{t('recap.lines.dragSweep')}</Text>
          <Text style={styles.line} allowFontScaling>{t('recap.lines.pinchZoom')}</Text>
          <Text style={styles.line} allowFontScaling>{t('recap.lines.undoLocator')}</Text>
          <Button title={t('recap.continue')} onPress={onContinue} variant="primary" style={styles.action} />
          <Button title={t('recap.browsePatterns')} onPress={onBrowsePatterns} variant="secondary" style={styles.action} />
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
