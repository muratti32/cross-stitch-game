import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Screen, Button, Card } from '@/components';
import { Theme } from '@/theme/theme';
import { withProtectedRoundTrip } from '@/navigation/foregroundEntryNavigation';
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
import { useIdentityStore } from '@/identity/guestIdentity';
import { useTranslation } from 'react-i18next';

export default function SignInScreen() {
  const { t } = useTranslation('settings');
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const isAccount = useIdentityStore((state) => state.isAccount);
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
    if (params.returnTo === '/onboarding/welcome') {
      router.replace('/onboarding/welcome');
      return;
    }
    if (isCommerceReturnTarget(params.returnTo)) {
      router.replace({
        pathname: '/(tabs)/(profile)/commerce',
        params: { source: 'sign_in_return' },
      });
      return;
    }
    if (params.returnTo === '/(tabs)/(profile)') {
      router.replace('/(tabs)/(profile)');
      return;
    }
    router.replace('/(tabs)/(settings)');
  };

  useEffect(() => {
    if (isAccount) {
      finishSignIn();
    }
  }, [isAccount]);

  const onCancel = () => {
    if (router.canGoBack()) {
      router.back();
    } else if (params.returnTo === '/(tabs)/(profile)') {
      router.replace('/(tabs)/(profile)');
    } else {
      router.replace('/(tabs)/(settings)');
    }
  };

  const onSendCode = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await requestEmailOtp(trimmedEmail);
      setStep('code');
    } catch {
      setError(t('signIn.sendCodeFailed'));
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
        setError(t('signIn.codeIncorrect'));
        setCode('');
      }
    } catch {
      setError(t('signIn.verifyFailedGeneric'));
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
      setError(t('signIn.sendCodeFailed'));
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
      const result = await withProtectedRoundTrip('authentication', () =>
        provider === 'apple' ? signInWithAppleSso() : signInWithGoogleSso(),
      );
      if (result.kind === 'signed-in') {
        finishSignIn();
      }
    } catch (signInError) {
      setError(
        signInError instanceof Error &&
          signInError.name === 'FirebaseSsoConfigurationError'
          ? signInError.message
          : t('signIn.socialSignInFailed', {
              provider: provider === 'apple' ? t('signIn.providerApple') : t('signIn.providerGoogle'),
            }),
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
            <Text style={styles.heading}>{t('signIn.emailHeading')}</Text>
            <Text style={styles.subtitle}>
              {t('signIn.emailSubtitle')}
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
                <Text style={styles.googleButtonText}>{t('signIn.continueWithGoogle')}</Text>
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
                <Text style={styles.dividerText}>{t('signIn.orUseEmail')}</Text>
                <View style={styles.dividerLine} />
              </View>
            )}

            {!firebaseConfigured && (
              <Text style={styles.configurationHint}>
                {t('signIn.ssoUnavailable')}
              </Text>
            )}

            <Text style={styles.emailLabel}>{t('signIn.emailLabel')}</Text>

            <TextInput
              style={styles.input}
              placeholder={t('signIn.emailPlaceholder')}
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
              title={t('signIn.sendCode')}
              variant="primary"
              loading={submitting}
              disabled={!validEmail || submitting}
              onPress={onSendCode}
            />
            <View style={styles.buttonSpacer} />
            <Button title={t('signIn.cancel')} variant="secondary" onPress={onCancel} />
          </View>
        ) : (
          <View>
            <Text style={styles.heading}>{t('signIn.codeHeading')}</Text>
            <Text style={styles.subtitle}>
              {t('signIn.codeSubtitle', { email: trimmedEmail })}
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
              title={t('signIn.verify')}
              variant="primary"
              loading={submitting}
              disabled={!validCode || submitting}
              onPress={onVerify}
            />

            <View style={styles.pressableRow}>
              <Pressable onPress={onResendCode} disabled={resending}>
                <Text style={[styles.linkText, resending && styles.linkTextDisabled]}>
                  {resending ? t('signIn.resending') : resent ? t('signIn.codeSent') : t('signIn.resendCode')}
                </Text>
              </Pressable>

              <Pressable onPress={onUseDifferentEmail}>
                <Text style={styles.linkText}>{t('signIn.useDifferentEmail')}</Text>
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
