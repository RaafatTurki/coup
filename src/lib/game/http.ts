type ApiError = { error?: string };

export class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

export function messageFromError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function parseResponsePayload(response: Response) {
  if (response.status === 204 || response.status === 205) {
    return null;
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  const isTextPayload =
    !contentType ||
    contentType.startsWith('text/') ||
    contentType.includes('application/xml') ||
    contentType.includes('text/html');

  if (!isTextPayload) {
    return null;
  }

  const text = await response.text();
  return text.trim() ? text : null;
}

export async function requestJson<T>(
  url: string,
  init: RequestInit | undefined,
  fallbackError: string
) {
  const response = await fetch(url, init);
  const payload = (await parseResponsePayload(response)) as (T & ApiError) | string | null;
  if (!response.ok) {
    const message =
      typeof payload === 'string'
        ? payload
        : payload && typeof payload === 'object' && typeof payload.error === 'string'
          ? payload.error
          : fallbackError;
    throw new ApiRequestError(`${message} (HTTP ${response.status})`, response.status);
  }

  if (!payload || typeof payload !== 'object') {
    throw new ApiRequestError('Invalid JSON response from server.', response.status);
  }

  return payload as T;
}
