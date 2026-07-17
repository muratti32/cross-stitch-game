'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLoginMutation, useMfaMutation } from '@/hooks/use-auth';
import { ApiError } from '@/lib/client/fetcher';

const credentialsSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
type CredentialsValues = z.infer<typeof credentialsSchema>;

const mfaCodeSchema = z.object({
  totpCode: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
});
type MfaCodeValues = z.infer<typeof mfaCodeSchema>;

const recoveryCodeSchema = z.object({
  recoveryCode: z.string().min(1, 'Enter a recovery code'),
});
type RecoveryCodeValues = z.infer<typeof recoveryCodeSchema>;

type Step = { kind: 'credentials' } | { kind: 'mfa'; challenge: string };

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return 'Something went wrong. Check your connection and try again.';
}

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  const loginMutation = useLoginMutation();
  const mfaMutation = useMfaMutation();

  const credentialsForm = useForm<CredentialsValues>({
    defaultValues: { email: '', password: '' },
    resolver: zodResolver(credentialsSchema),
  });
  const mfaCodeForm = useForm<MfaCodeValues>({
    defaultValues: { totpCode: '' },
    resolver: zodResolver(mfaCodeSchema),
  });
  const recoveryCodeForm = useForm<RecoveryCodeValues>({
    defaultValues: { recoveryCode: '' },
    resolver: zodResolver(recoveryCodeSchema),
  });

  async function handleCredentialsSubmit(values: CredentialsValues): Promise<void> {
    try {
      const response = await loginMutation.mutateAsync(values);
      setStep({ challenge: response.challenge, kind: 'mfa' });
    } catch {
      // Surfaced via loginMutation.error below.
    }
  }

  async function submitMfa(payload: { totpCode?: string; recoveryCode?: string }): Promise<void> {
    if (step.kind !== 'mfa') {
      return;
    }
    try {
      await mfaMutation.mutateAsync({ challenge: step.challenge, ...payload });
      router.push('/');
      router.refresh();
    } catch {
      // Surfaced via mfaMutation.error below.
    }
  }

  function startOver(): void {
    setStep({ kind: 'credentials' });
    setUseRecoveryCode(false);
    loginMutation.reset();
    mfaMutation.reset();
    mfaCodeForm.reset();
    recoveryCodeForm.reset();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Operator Console</CardTitle>
        <CardDescription>
          {step.kind === 'credentials'
            ? 'Sign in with your operator credentials.'
            : 'Enter your authenticator code to finish signing in.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {step.kind === 'credentials' && (
          <form className="space-y-4" onSubmit={credentialsForm.handleSubmit(handleCredentialsSubmit)}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                {...credentialsForm.register('email')}
              />
              {credentialsForm.formState.errors.email !== undefined && (
                <p className="text-sm text-destructive">
                  {credentialsForm.formState.errors.email.message}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...credentialsForm.register('password')}
              />
              {credentialsForm.formState.errors.password !== undefined && (
                <p className="text-sm text-destructive">
                  {credentialsForm.formState.errors.password.message}
                </p>
              )}
            </div>
            {loginMutation.isError && (
              <Alert variant="destructive">
                <AlertDescription>{describeError(loginMutation.error)}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? 'Signing in…' : 'Continue'}
            </Button>
          </form>
        )}

        {step.kind === 'mfa' && useRecoveryCode && (
          <form
            className="space-y-4"
            onSubmit={recoveryCodeForm.handleSubmit((values) => submitMfa({ recoveryCode: values.recoveryCode }))}
          >
            <div className="space-y-1.5">
              <Label htmlFor="recoveryCode">Recovery code</Label>
              <Input
                id="recoveryCode"
                autoComplete="one-time-code"
                {...recoveryCodeForm.register('recoveryCode')}
              />
              {recoveryCodeForm.formState.errors.recoveryCode !== undefined && (
                <p className="text-sm text-destructive">
                  {recoveryCodeForm.formState.errors.recoveryCode.message}
                </p>
              )}
            </div>
            {mfaMutation.isError && (
              <Alert variant="destructive">
                <AlertDescription>{describeError(mfaMutation.error)}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={mfaMutation.isPending}>
              {mfaMutation.isPending ? 'Verifying…' : 'Verify and sign in'}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                className="text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => setUseRecoveryCode(false)}
              >
                Use authenticator code instead
              </button>
              <button
                type="button"
                className="text-muted-foreground underline-offset-4 hover:underline"
                onClick={startOver}
              >
                Start over
              </button>
            </div>
          </form>
        )}

        {step.kind === 'mfa' && !useRecoveryCode && (
          <form
            className="space-y-4"
            onSubmit={mfaCodeForm.handleSubmit((values) => submitMfa({ totpCode: values.totpCode }))}
          >
            <div className="space-y-1.5">
              <Label htmlFor="totpCode">Authenticator code</Label>
              <Input
                id="totpCode"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                {...mfaCodeForm.register('totpCode')}
              />
              {mfaCodeForm.formState.errors.totpCode !== undefined && (
                <p className="text-sm text-destructive">{mfaCodeForm.formState.errors.totpCode.message}</p>
              )}
            </div>
            {mfaMutation.isError && (
              <Alert variant="destructive">
                <AlertDescription>{describeError(mfaMutation.error)}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={mfaMutation.isPending}>
              {mfaMutation.isPending ? 'Verifying…' : 'Verify and sign in'}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                className="text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => setUseRecoveryCode(true)}
              >
                Use a recovery code instead
              </button>
              <button
                type="button"
                className="text-muted-foreground underline-offset-4 hover:underline"
                onClick={startOver}
              >
                Start over
              </button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
