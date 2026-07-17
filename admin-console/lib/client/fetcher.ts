import type { BackendErrorPayload } from '../types';

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, payload: unknown, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

interface RequestOptions extends RequestInit {
  /** Skip the redirect-to-/login behavior on 401 (used only by the login form). */
  suppressAuthRedirect?: boolean;
}

function extractMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const message = (payload as BackendErrorPayload).message;
    if (typeof message === 'string') {
      return message;
    }
    if (Array.isArray(message) && message.every((entry) => typeof entry === 'string')) {
      return message.join(', ');
    }
  }
  return fallback;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { suppressAuthRedirect, headers: initHeaders, body, ...rest } = options;
  const headers = new Headers(initHeaders);
  if (body !== undefined && !(body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(url, { ...rest, body, credentials: 'same-origin', headers });

  if (response.status === 401 && suppressAuthRedirect !== true) {
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    throw new ApiError(401, null, 'Your session has expired. Redirecting to sign in.');
  }

  const text = await response.text();
  const payload: unknown = text.length > 0 ? safeJsonParse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload,
      extractMessage(payload, `Request failed with status ${response.status}`),
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(url: string): Promise<T> => request<T>(url, { method: 'GET' }),
  post: <T>(url: string, body?: unknown): Promise<T> =>
    request<T>(url, { body: body === undefined ? undefined : JSON.stringify(body), method: 'POST' }),
  postForm: <T>(url: string, form: FormData): Promise<T> => request<T>(url, { body: form, method: 'POST' }),
  put: <T>(url: string, body?: unknown): Promise<T> =>
    request<T>(url, { body: JSON.stringify(body), method: 'PUT' }),
};

/** Used only by the login/MFA form: 401 there means "wrong credentials," not "session expired." */
export const authApi = {
  post: <T>(url: string, body?: unknown): Promise<T> =>
    request<T>(url, {
      body: body === undefined ? undefined : JSON.stringify(body),
      method: 'POST',
      suppressAuthRedirect: true,
    }),
};
