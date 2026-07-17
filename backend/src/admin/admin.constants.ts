// Structural security constants (not environment-configurable, same spirit as
// auth.ACCESS_TOKEN_VERSION): an operator access token issued with any other
// issuer/audience/algorithm can never be accepted by OperatorAuthGuard, and a
// player access token (signed with a different secret and issuer/audience)
// can never verify against these either.
export const ADMIN_JWT_ISSUER = 'stitchwish-admin';
export const ADMIN_JWT_AUDIENCE = 'stitchwish-admin';
export const ADMIN_PRINCIPAL_TYPE = 'operator' as const;

export const OPERATOR_LOGIN_CHALLENGE_BYTES = 32;
export const OPERATOR_LOGIN_CHALLENGE_TTL_SECONDS = 5 * 60;
export const OPERATOR_RECOVERY_CODE_COUNT = 10;
export const OPERATOR_RECOVERY_CODE_BYTES = 10;
export const OPERATOR_OPAQUE_REFRESH_TOKEN_BYTES = 32;
export const OPERATOR_PASSWORD_MIN_LENGTH = 12;
export const OPERATOR_PASSWORD_BCRYPT_LIKE_ROUNDS = 3; // argon2 timeCost

export const OPERATOR_LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 10;
export const OPERATOR_LOGIN_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
export const OPERATOR_MFA_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const OPERATOR_MFA_RATE_LIMIT_WINDOW_SECONDS = 5 * 60;

export const OFFICIAL_PATTERN_DRAFT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const MAX_TAG_CODES_PER_PATTERN = 5;
