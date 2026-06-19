import { DEFAULT_AVATAR } from '../store/useAppStore';

export const resolveProfileAvatarSrc = (
  _userId: string | number | null | undefined,
  _avatarUrl: string | null | undefined,
  fallback: string | null = DEFAULT_AVATAR,
): string => {
  return fallback || DEFAULT_AVATAR;
};

export const resolveVideoAvatarSrc = (
  _videoUserId: string | number | null | undefined,
  _videoAvatarUrl: string | null | undefined,
  _currentUserId: string | number | null | undefined,
  _currentUserAvatarUrl: string | null | undefined,
  fallback: string | null = DEFAULT_AVATAR,
): string => {
  return fallback || DEFAULT_AVATAR;
};
