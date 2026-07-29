import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Screen, Button, Card } from '@/components';
import { Theme } from '@/theme/theme';
import { requestEmailOtp, verifyEmailOtp } from '@/identity/emailAuth';
import {
  canUseAppleSso,
  canUseGoogleSso,
  signInWithAppleSso,
  signInWithGoogleSso,
} from '@/identity/firebaseSso';
import { isFirebaseSsoConfigured } from '@/config';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { isCommerceReturnTarget } from '@/commerce/commerceIntent';

export default function SignInScreen() {
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [resending, setResending] = useState<boolean>(false);
  const [resent, setResent] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState<boolean>(false);
  const [socialProvider, setSocialProvider] = useState<'apple' | 'google' | null>(null);

  const firebaseConfigured = isFirebaseSsoConfigured();
  const googleAvailable = canUseGoogleSso();

  useEffect(() => {
    canUseAppleSso()
      .then(setAppleAvailable)
      .catch(() => setAppleAvailable(false));
  }, []);

  const trimmedEmail = email.trim();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
  const validCode = code.length === 6;

  const finishSignIn = () => {
    if (isCommerceReturnTarget(params.returnTo)) {
      router.replace({
        pathname: '/(tabs)/(profile)/commerce',
        params: { source: 'sign_in_return' },
      });
      return;
    }
    router.back();
  };

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
        finishSignIn();
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

  const onSocialSignIn = async (provider: 'apple' | 'google') => {
    setError(null);
    setSocialProvider(provider);
    try {
      const result =
        provider === 'apple'
          ? await signInWithAppleSso()
          : await signInWithGoogleSso();
      if (result.kind === 'signed-in') {
        finishSignIn();
      }
    } catch (signInError) {
      setError(
        signInError instanceof Error &&
          signInError.name === 'FirebaseSsoConfigurationError'
          ? signInError.message
          : `Couldn't sign in with ${provider === 'apple' ? 'Apple' : 'Google'}. Please try again.`,
      );
    } finally {
      setSocialProvider(null);
    }
  };

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      <Card style={styles.card}>
        {step === 'email' ? (
          <View>
            <Text style={styles.heading}>Sign in or create account</Text>
            <Text style={styles.subtitle}>
              Keep your progress available across devices.
            </Text>

            {error && (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle-outline" size={16} color={Theme.colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {googleAvailable && (
              <Pressable
                accessibilityRole="button"
                disabled={socialProvider !== null || submitting}
                onPress={() => void onSocialSignIn('google')}
                style={({ pressed }) => [
                  styles.googleButton,
                  pressed && styles.socialButtonPressed,
                  socialProvider !== null && styles.socialButtonDisabled,
                ]}
              >
                {socialProvider === 'google' ? (
                  <ActivityIndicator size="small" color={Theme.colors.textPrimary} />
                ) : (
                  <Ionicons name="logo-google" size={20} color={Theme.colors.googleBlue} />
                )}
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              </Pressable>
            )}

            {appleAvailable && (
              <View
                pointerEvents={socialProvider === null && !submitting ? 'auto' : 'none'}
                style={socialProvider !== null && styles.socialButtonDisabled}
              >
                <AppleAuthentication.AppleAuthenticationButton
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                  cornerRadius={Theme.radii.md}
                  onPress={() => void onSocialSignIn('apple')}
                  style={styles.appleButton}
                />
              </View>
            )}

            {(googleAvailable || appleAvailable) && (
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or use email</Text>
                <View style={styles.dividerLine} />
              </View>
            )}

            {!firebaseConfigured && (
              <Text style={styles.configurationHint}>
                Google and Apple sign-in are unavailable in this build.
              </Text>
            )}

            <Text style={styles.emailLabel}>Email address</Text>

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
  googleButton: {
    height: 48,
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    backgroundColor: Theme.colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Theme.spacing.sm,
    marginBottom: Theme.spacing.md,
  },
  googleButtonText: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.semibold,
  },
  appleButton: {
    width: '100%',
    height: 48,
    marginBottom: Theme.spacing.md,
  },
  socialButtonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  socialButtonDisabled: {
    opacity: 0.55,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    marginVertical: Theme.spacing.md,
  },
  dividerLine: {
    height: 1,
    flex: 1,
    backgroundColor: Theme.colors.border,
  },
  dividerText: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.medium,
  },
  configurationHint: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.xs,
    lineHeight: 17,
    textAlign: 'center',
    marginBottom: Theme.spacing.lg,
  },
  emailLabel: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
    marginBottom: Theme.spacing.sm,
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
