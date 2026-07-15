import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import { Screen, Button, Card } from '@/components';
import { Theme } from '@/theme/theme';
import { requestEmailOtp, verifyEmailOtp } from '@/identity/emailAuth';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function SignInScreen() {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [resending, setResending] = useState<boolean>(false);
  const [resent, setResent] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedEmail = email.trim();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
  const validCode = code.length === 6;

  const onSendCode = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await requestEmailOtp(trimmedEmail);
      setStep('code');
    } catch {
      setError("Couldn't send the code. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const onVerify = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const r = await verifyEmailOtp(trimmedEmail, code);
      if (r.kind === 'verified') {
        router.back();
      } else {
        setError('That code is incorrect or has expired.');
        setCode('');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const onResendCode = async () => {
    if (resending) return;
    setResending(true);
    setError(null);
    try {
      await requestEmailOtp(trimmedEmail);
      setResent(true);
      setTimeout(() => {
        setResent(false);
      }, 3000);
    } catch {
      setError("Couldn't send the code. Check your connection and try again.");
    } finally {
      setResending(false);
    }
  };

  const onUseDifferentEmail = () => {
    setStep('email');
    setCode('');
    setError(null);
  };

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      <Card style={styles.card}>
        {step === 'email' ? (
          <View>
            <Text style={styles.heading}>Sign in with email</Text>
            <Text style={styles.subtitle}>
              We&apos;ll email you a 6-digit code to sign in. No password needed.
            </Text>

            {error && (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle-outline" size={16} color={Theme.colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <TextInput
              style={styles.input}
              placeholder="Email address"
              placeholderTextColor={Theme.colors.textSecondary}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
            />

            <Button
              title="Send code"
              variant="primary"
              loading={submitting}
              disabled={!validEmail || submitting}
              onPress={onSendCode}
            />
            <View style={styles.buttonSpacer} />
            <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
          </View>
        ) : (
          <View>
            <Text style={styles.heading}>Enter your code</Text>
            <Text style={styles.subtitle}>
              Enter the 6-digit code we sent to {trimmedEmail}.
            </Text>

            {error && (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle-outline" size={16} color={Theme.colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <TextInput
              style={styles.codeInput}
              placeholder="000000"
              placeholderTextColor={Theme.colors.textSecondary}
              value={code}
              onChangeText={(v) => setCode(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={6}
            />

            <Button
              title="Verify"
              variant="primary"
              loading={submitting}
              disabled={!validCode || submitting}
              onPress={onVerify}
            />

            <View style={styles.pressableRow}>
              <Pressable onPress={onResendCode} disabled={resending}>
                <Text style={[styles.linkText, resending && styles.linkTextDisabled]}>
                  {resending ? 'Resending...' : resent ? 'Code sent' : 'Resend code'}
                </Text>
              </Pressable>

              <Pressable onPress={onUseDifferentEmail}>
                <Text style={styles.linkText}>Use a different email</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: Theme.colors.background,
    padding: Theme.spacing.lg,
    justifyContent: 'center',
  },
  card: {
    padding: Theme.spacing.xl,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  heading: {
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    marginBottom: Theme.spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    marginBottom: Theme.spacing.xl,
    textAlign: 'center',
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.lg,
    padding: Theme.spacing.md,
    fontSize: Theme.typography.sizes.md,
    color: Theme.colors.textPrimary,
    backgroundColor: Theme.colors.card,
    marginBottom: Theme.spacing.md,
  },
  codeInput: {
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.lg,
    padding: Theme.spacing.md,
    fontSize: Theme.typography.sizes.lg * 1.5,
    textAlign: 'center',
    letterSpacing: 8,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
    backgroundColor: Theme.colors.card,
    marginBottom: Theme.spacing.md,
  },
  buttonSpacer: {
    height: Theme.spacing.md,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(211, 93, 93, 0.1)',
    padding: Theme.spacing.sm,
    borderRadius: Theme.radii.sm,
    marginBottom: Theme.spacing.md,
    gap: Theme.spacing.xs,
  },
  errorText: {
    color: Theme.colors.error,
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.medium,
    flex: 1,
  },
  pressableRow: {
    flexDirection: 'column',
    alignItems: 'center',
    marginTop: Theme.spacing.lg,
    gap: Theme.spacing.md,
  },
  linkText: {
    color: Theme.colors.accentTeal,
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
  },
  linkTextDisabled: {
    color: Theme.colors.textSecondary,
  },
});
