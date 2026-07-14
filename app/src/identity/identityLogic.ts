/**
 * Pure logic for guest identity, JWT token handling, and scheduling decisions.
 * This file must not import any React Native or Expo modules to remain 100% testable in Jest.
 */

export interface JwtPayload {
  exp?: number;
  iat?: number;
  id?: string;
  type?: string;
  tokenVersion?: number;
}

/**
 * Decodes a JWT payload from a token string without signature verification.
 */
export function decodeJwt(token: string): JwtPayload {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    
    // Standard base64 decoding in pure JS
    const binary = atobPure(base64);
    const jsonPayload = decodeURIComponent(
      binary
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Failed to decode JWT:', error);
    return {};
  }
}

/**
 * Pure JS implementation of atob to avoid dependencies on browser/Node globals.
 */
function atobPure(input: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let str = input.replace(/=+$/, '');
  let output = '';
  if (str.length % 4 === 1) {
    throw new Error('Invalid base64 string');
  }
  for (let i = 0, bc = 0, bs = 0; i < str.length; i++) {
    const char = str[i];
    const idx = chars.indexOf(char);
    if (idx === -1) continue;
    bs = bc % 4 ? bs * 64 + idx : idx;
    if (bc++ % 4) {
      output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
    }
  }
  return output;
}

/**
 * Calculates the delay in seconds until a token needs proactive refresh.
 * Proactive refresh is targetted at 12 minutes (720 seconds) after issuance (iat).
 */
export function calculateRefreshDelay(exp: number, iat: number, nowSeconds: number): number {
  const targetRefreshTime = iat + 720;
  const delay = targetRefreshTime - nowSeconds;
  return delay > 0 ? delay : 0;
}

/**
 * Determines if the token is already older than 12 minutes (720 seconds) since issuance.
 */
export function isTokenOlderThan12Minutes(iat: number, nowSeconds: number): boolean {
  return (nowSeconds - iat) >= 720;
}

/**
 * Returns a shortened, user-friendly representation of a guestId.
 */
export function shortenGuestId(guestId: string): string {
  if (!guestId) return '';
  // e.g. for guest_uuid, we take the first 8 characters
  if (guestId.length <= 8) return guestId;
  return `${guestId.substring(0, 8)}...`;
}

/**
 * Custom base64url encoding helper for Uint8Array.
 */
export function bufferToBase64Url(buffer: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  const len = buffer.length;
  let i = 0;

  while (i < len) {
    const byte1 = buffer[i++];
    const byte2 = i < len ? buffer[i++] : NaN;
    const byte3 = i < len ? buffer[i++] : NaN;

    const enc1 = byte1 >> 2;
    const enc2 = ((byte1 & 3) << 4) | (isNaN(byte2) ? 0 : byte2 >> 4);
    const enc3 = isNaN(byte2) ? NaN : ((byte2 & 15) << 2) | (isNaN(byte3) ? 0 : byte3 >> 6);
    const enc4 = isNaN(byte3) ? NaN : byte3 & 63;

    result += chars.charAt(enc1) + chars.charAt(enc2);
    if (!isNaN(enc3)) {
      result += chars.charAt(enc3);
    }
    if (!isNaN(enc4)) {
      result += chars.charAt(enc4);
    }
  }
  return result;
}
