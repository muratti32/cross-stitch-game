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

import {
  communityReportValidationError,
  useCreateCommunityReport,
} from '@/api/communityReports';
import type { CommunityReportReason } from '@/api/communityReports';
import { useIdentityStore } from '@/identity/guestIdentity';
import { Theme } from '@/theme/theme';
import { Button } from './Button';
import { Card } from './Card';

const REASONS: { label: string; value: CommunityReportReason }[] = [
  {
    label: 'Inappropriate or Unsafe Content',
    value: 'inappropriate_or_unsafe_content',
  },
  {
    label: 'Copyright or Publication Rights',
    value: 'copyright_or_publication_rights',
  },
  { label: 'Duplicate or Spam', value: 'duplicate_or_spam' },
  { label: 'Misleading Title or Tags', value: 'misleading_title_or_tags' },
  { label: 'Other', value: 'other' },
];

interface CommunityReportActionProps {
  patternId: string;
  patternTitle: string;
}

export function CommunityReportAction({
  patternId,
  patternTitle,
}: CommunityReportActionProps) {
  const router = useRouter();
  const isAccount = useIdentityStore((state) => state.isAccount);
  const mutation = useCreateCommunityReport();
  const [visible, setVisible] = useState(false);
  const [reason, setReason] = useState<CommunityReportReason | undefined>();
  const [explanation, setExplanation] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const open = () => {
    if (!isAccount) {
      Alert.alert(
        'Sign in to report',
        'Community Reports require a Registered Account. Nothing has been submitted.',
        [
          { style: 'cancel', text: 'Cancel' },
          {
            onPress: () => router.push('/(tabs)/(settings)/sign-in'),
            text: 'Sign in',
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
        result.created ? 'Report received' : 'Report already received',
        result.created
          ? 'A moderator can now review this pattern. The report does not automatically change its availability.'
          : 'Your existing report is already part of the open review.',
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
        title="Report this pattern"
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
                  Report {patternTitle}
                </Text>
                <Text style={styles.body}>
                  Choose the reason that best describes the issue. Reports never hide or
                  change a pattern automatically.
                </Text>

                <View accessibilityRole="radiogroup" style={styles.reasonList}>
                  {REASONS.map((option) => {
                    const selected = reason === option.value;
                    return (
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        key={option.value}
                        onPress={() => {
                          setReason(option.value);
                          setValidationError(null);
                        }}
                        style={[styles.reasonRow, selected && styles.reasonRowSelected]}
                      >
                        <View style={[styles.radio, selected && styles.radioSelected]} />
                        <Text style={styles.reasonLabel}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.inputLabel}>
                  Evidence or explanation {reason === 'other' ? '(required)' : '(optional)'}
                </Text>
                <TextInput
                  editable={!mutation.isPending}
                  maxLength={2000}
                  multiline
                  onChangeText={setExplanation}
                  placeholder="Share details that will help a moderator review the pattern."
                  placeholderTextColor={Theme.colors.textSecondary}
                  style={styles.input}
                  textAlignVertical="top"
                  value={explanation}
                />
                <Text style={styles.characterCount}>{explanation.length}/2000</Text>

                {validationError !== null ? (
                  <Text style={styles.error}>{validationError}</Text>
                ) : null}
                {mutation.error instanceof Error ? (
                  <Text style={styles.error}>{mutation.error.message}</Text>
                ) : null}

                <View style={styles.actions}>
                  <Button
                    disabled={mutation.isPending}
                    onPress={close}
                    style={styles.action}
                    title="Cancel"
                    variant="secondary"
                  />
                  <Button
                    loading={mutation.isPending}
                    onPress={() => void submit()}
                    style={styles.action}
                    title="Submit report"
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
