import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  communityReportValidationError,
  useCreateCommunityReport,
} from '@/api/communityReports';
import type { CommunityReportReason } from '@/api/communityReports';
import { useIdentityStore } from '@/identity/guestIdentity';
import { Theme } from '@/theme/theme';
import { Button } from './Button';
import { Card } from './Card';

const REASON_VALUES: CommunityReportReason[] = [
  'inappropriate_or_unsafe_content',
  'copyright_or_publication_rights',
  'duplicate_or_spam',
  'misleading_title_or_tags',
  'other',
];

// communityReportValidationError (src/api/communityReports.ts) is a pure
// function tested directly on its English return values - see
// communityReports.test.ts - so it is not changed here. This maps its known
// literal outputs to localized text for display; an unrecognized string
// (there should never be one) falls back to the raw value rather than
// crashing.
const VALIDATION_ERROR_KEYS: Record<string, string> = {
  'Choose a report reason.': 'detail.communityReport.validation.chooseReason',
  'Explain why you are reporting this pattern.': 'detail.communityReport.validation.explainRequired',
  'The explanation must be 2,000 characters or fewer.': 'detail.communityReport.validation.tooLong',
  'The explanation must include letters or numbers.': 'detail.communityReport.validation.needsContent',
};

interface CommunityReportActionProps {
  patternId: string;
  patternTitle: string;
}

export function CommunityReportAction({
  patternId,
  patternTitle,
}: CommunityReportActionProps) {
  const { t } = useTranslation('catalog');
  const router = useRouter();
  const isAccount = useIdentityStore((state) => state.isAccount);
  const mutation = useCreateCommunityReport();
  const [visible, setVisible] = useState(false);
  const [reason, setReason] = useState<CommunityReportReason | undefined>();
  const [explanation, setExplanation] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const localizeValidationError = (raw: string): string => {
    const key = VALIDATION_ERROR_KEYS[raw];
    return key ? t(key) : raw;
  };

  const open = () => {
    if (!isAccount) {
      Alert.alert(
        t('detail.communityReport.signInRequired.title'),
        t('detail.communityReport.signInRequired.message'),
        [
          { style: 'cancel', text: t('detail.communityReport.signInRequired.cancel') },
          {
            onPress: () => router.push('/(tabs)/(settings)/sign-in'),
            text: t('detail.communityReport.signInRequired.signIn'),
          },
        ],
      );
      return;
    }
    mutation.reset();
    setValidationError(null);
    setVisible(true);
  };

  const resetAndClose = () => {
    setVisible(false);
    setReason(undefined);
    setExplanation('');
    setValidationError(null);
    mutation.reset();
  };

  const close = () => {
    if (mutation.isPending) return;
    resetAndClose();
  };

  const submit = async () => {
    const input = { explanation, reason };
    const error = communityReportValidationError(input);
    if (error !== null || reason === undefined) {
      setValidationError(error);
      return;
    }

    setValidationError(null);
    try {
      const result = await mutation.mutateAsync({
        input: { explanation, reason },
        patternId,
      });
      resetAndClose();
      Alert.alert(
        result.created
          ? t('detail.communityReport.receivedTitle')
          : t('detail.communityReport.alreadyReceivedTitle'),
        result.created
          ? t('detail.communityReport.receivedBody')
          : t('detail.communityReport.alreadyReceivedBody'),
      );
    } catch {
      // The mutation error is rendered in the modal so it remains actionable.
    }
  };

  return (
    <>
      <Button
        onPress={open}
        style={styles.reportButton}
        title={t('detail.communityReport.button')}
        variant="secondary"
      />
      <Modal
        animationType="slide"
        onRequestClose={close}
        transparent
        visible={visible}
      >
        <View style={styles.backdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardContainer}
          >
            <Card style={styles.modalCard}>
              <ScrollView
                contentContainerStyle={styles.modalContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text accessibilityRole="header" style={styles.title}>
                  {t('detail.communityReport.title', { patternTitle })}
                </Text>
                <Text style={styles.body}>
                  {t('detail.communityReport.body')}
                </Text>

                <View accessibilityRole="radiogroup" style={styles.reasonList}>
                  {REASON_VALUES.map((value) => {
                    const selected = reason === value;
                    return (
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        key={value}
                        onPress={() => {
                          setReason(value);
                          setValidationError(null);
                        }}
                        style={[styles.reasonRow, selected && styles.reasonRowSelected]}
                      >
                        <View style={[styles.radio, selected && styles.radioSelected]} />
                        <Text style={styles.reasonLabel}>{t(`detail.communityReport.reasons.${value}`)}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.inputLabel}>
                  {t('detail.communityReport.explanationLabel', {
                    requirement: reason === 'other'
                      ? t('detail.communityReport.explanationRequired')
                      : t('detail.communityReport.explanationOptional'),
                  })}
                </Text>
                <TextInput
                  editable={!mutation.isPending}
                  maxLength={2000}
                  multiline
                  onChangeText={setExplanation}
                  placeholder={t('detail.communityReport.explanationPlaceholder')}
                  placeholderTextColor={Theme.colors.textSecondary}
                  style={styles.input}
                  textAlignVertical="top"
                  value={explanation}
                />
                <Text style={styles.characterCount}>{t('detail.communityReport.characterCount', { count: explanation.length })}</Text>

                {validationError !== null ? (
                  <Text style={styles.error}>{localizeValidationError(validationError)}</Text>
                ) : null}
                {mutation.error instanceof Error ? (
                  <Text style={styles.error}>{t('detail.communityReport.submitFailedGeneric')}</Text>
                ) : null}

                <View style={styles.actions}>
                  <Button
                    disabled={mutation.isPending}
                    onPress={close}
                    style={styles.action}
                    title={t('detail.communityReport.cancel')}
                    variant="secondary"
                  />
                  <Button
                    loading={mutation.isPending}
                    onPress={() => void submit()}
                    style={styles.action}
                    title={t('detail.communityReport.submit')}
                    variant="rose"
                  />
                </View>
              </ScrollView>
            </Card>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  action: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    marginTop: Theme.spacing.lg,
  },
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(46, 42, 37, 0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: Theme.spacing.lg,
  },
  body: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.sm,
    lineHeight: 20,
    marginTop: Theme.spacing.sm,
  },
  characterCount: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.xs,
    marginTop: Theme.spacing.xs,
    textAlign: 'right',
  },
  error: {
    color: Theme.colors.error,
    fontSize: Theme.typography.sizes.sm,
    marginTop: Theme.spacing.sm,
  },
  input: {
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.sm,
    height: 112,
    marginTop: Theme.spacing.xs,
    padding: Theme.spacing.md,
  },
  inputLabel: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
    marginTop: Theme.spacing.lg,
  },
  keyboardContainer: {
    maxHeight: '90%',
    maxWidth: 520,
    width: '100%',
  },
  modalCard: {
    maxHeight: '100%',
    padding: 0,
    width: '100%',
  },
  modalContent: {
    padding: Theme.spacing.lg,
  },
  radio: {
    borderColor: Theme.colors.textSecondary,
    borderRadius: Theme.radii.full,
    borderWidth: 1.5,
    height: 18,
    width: 18,
  },
  radioSelected: {
    backgroundColor: Theme.colors.accentTeal,
    borderColor: Theme.colors.accentTeal,
    borderWidth: 4,
  },
  reasonLabel: {
    color: Theme.colors.textPrimary,
    flex: 1,
    fontSize: Theme.typography.sizes.sm,
  },
  reasonList: {
    gap: Theme.spacing.xs,
    marginTop: Theme.spacing.lg,
  },
  reasonRow: {
    alignItems: 'center',
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    minHeight: 44,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  reasonRowSelected: {
    backgroundColor: Theme.colors.overlayPressed,
    borderColor: Theme.colors.accentTeal,
  },
  reportButton: {
    marginBottom: Theme.spacing.xl,
  },
  title: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.xl,
    fontWeight: Theme.typography.weights.bold,
  },
});
