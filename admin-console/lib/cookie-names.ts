// Shared cookie name constants. Kept in a plain module (no `server-only`
// import) because both server-side code (lib/session.ts, route handlers) and
// the edge-safe proxy.ts need to agree on these names without pulling
// next/headers into the proxy bundle.
export const ACCESS_TOKEN_COOKIE = 'sw_admin_access_token';
export const REFRESH_TOKEN_COOKIE = 'sw_admin_refresh_token';
export const OPERATOR_PROFILE_COOKIE = 'sw_admin_operator';
