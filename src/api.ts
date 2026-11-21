// Auth token is held strictly in JS memory — never persisted in localStorage or sessionStorage
let inMemoryBearerToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  inMemoryBearerToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryBearerToken;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  const hadAuthToken = Boolean(inMemoryBearerToken);
  if (inMemoryBearerToken) {
    headers.set('Authorization', `Bearer ${inMemoryBearerToken}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && hadAuthToken && !url.startsWith('/api/auth/change-password')) {
      inMemoryBearerToken = null;
      unauthorizedHandler?.();
    }
    throw new ApiError(
      data?.error || `Request failed with status ${res.status}`,
      res.status,
      data?.code
    );
  }
  return data as T;
}
