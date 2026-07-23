import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Config } from '@/config';
import { apiFetch } from './apiFetch';

export interface CreatorProfile {
  avatarUrl: string | null;
  createdAt: string;
  displayName: string;
  id: string;
  updatedAt: string;
  username: string;
}

export interface AvatarUpload {
  fileName?: string | null;
  mimeType?: string | null;
  uri: string;
}

export class CreatorProfileApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason: string | null,
  ) {
    super(message);
    this.name = 'CreatorProfileApiError';
  }
}

function creatorProfileQueryKey(accountId: string | null) {
  return ['creator-profile', 'me', accountId] as const;
}

export async function getMyCreatorProfile(): Promise<CreatorProfile | null> {
  const response = await apiFetch('/v1/creator-profiles/me');
  if (response.status === 404) return null;
  if (!response.ok) throw await profileError(response, 'Could not load your public profile');
  return withAbsoluteAvatarUrl((await response.json()) as CreatorProfile);
}

export async function createCreatorProfile(input: {
  avatar?: AvatarUpload;
  displayName: string;
  username: string;
}): Promise<CreatorProfile> {
  const body = new FormData();
  body.append('username', input.username);
  body.append('displayName', input.displayName);
  if (input.avatar !== undefined) await appendAvatar(body, input.avatar);

  const response = await apiFetch('/v1/creator-profiles', { body, method: 'POST' });
  if (!response.ok) throw await profileError(response, 'Could not create your public profile');
  return withAbsoluteAvatarUrl((await response.json()) as CreatorProfile);
}

export async function updateCreatorProfile(input: {
  avatar?: AvatarUpload;
  displayName: string;
  removeAvatar?: boolean;
}): Promise<CreatorProfile> {
  const body = new FormData();
  body.append('displayName', input.displayName);
  if (input.avatar !== undefined) {
    await appendAvatar(body, input.avatar);
  } else if (input.removeAvatar === true) {
    body.append('removeAvatar', 'true');
  }

  const response = await apiFetch('/v1/creator-profiles/me', { body, method: 'PATCH' });
  if (!response.ok) throw await profileError(response, 'Could not update your public profile');
  return withAbsoluteAvatarUrl((await response.json()) as CreatorProfile);
}

export function useCreatorProfile(accountId: string | null, enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: getMyCreatorProfile,
    queryKey: creatorProfileQueryKey(accountId),
    retry: false,
  });
}

export function useSaveCreatorProfile(accountId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      input:
        | { kind: 'create'; avatar?: AvatarUpload; displayName: string; username: string }
        | { kind: 'update'; avatar?: AvatarUpload; displayName: string; removeAvatar?: boolean },
    ) =>
      input.kind === 'create'
        ? createCreatorProfile(input)
        : updateCreatorProfile(input),
    onSuccess: (profile) => {
      queryClient.setQueryData(creatorProfileQueryKey(accountId), profile);
    },
  });
}

function withAbsoluteAvatarUrl(profile: CreatorProfile): CreatorProfile {
  return {
    ...profile,
    avatarUrl:
      profile.avatarUrl === null || profile.avatarUrl.startsWith('http')
        ? profile.avatarUrl
        : `${Config.apiBaseUrl}${profile.avatarUrl}`,
  };
}

async function appendAvatar(body: FormData, avatar: AvatarUpload): Promise<void> {
  const extension = avatar.mimeType === 'image/png'
    ? 'png'
    : avatar.mimeType === 'image/webp'
      ? 'webp'
      : 'jpg';
  const fileName = avatar.fileName ?? `creator-avatar.${extension}`;
  if (Platform.OS === 'web') {
    const blob = await fetch(avatar.uri).then((response) => response.blob());
    body.append('avatar', blob, fileName);
    return;
  }
  body.append('avatar', new File(avatar.uri) as unknown as Blob, fileName);
}

async function profileError(response: Response, fallback: string): Promise<CreatorProfileApiError> {
  let message = fallback;
  let reason: string | null = null;
  try {
    const body = (await response.json()) as { message?: unknown; reason?: unknown };
    if (typeof body.message === 'string') message = body.message;
    if (Array.isArray(body.message)) {
      message = body.message.filter((item): item is string => typeof item === 'string').join(', ');
    }
    if (typeof body.reason === 'string') reason = body.reason;
  } catch {
    // The fallback remains actionable if the backend has no JSON error body.
  }
  return new CreatorProfileApiError(response.status, message, reason);
}
