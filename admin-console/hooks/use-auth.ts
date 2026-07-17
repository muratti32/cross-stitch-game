'use client';

import { useMutation } from '@tanstack/react-query';

import { authApi } from '@/lib/client/fetcher';
import type { MfaRequiredResponse, MfaSuccessResponse } from '@/lib/types';

export function useLoginMutation() {
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      authApi.post<MfaRequiredResponse>('/api/auth/login', input),
  });
}

export function useMfaMutation() {
  return useMutation({
    mutationFn: (input: { challenge: string; totpCode?: string; recoveryCode?: string }) =>
      authApi.post<MfaSuccessResponse>('/api/auth/mfa', input),
  });
}
