/** Sends a request and returns the parsed JSON response, throwing the server's error message on failure. */
export async function requestJson<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Request failed (HTTP ${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

export function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>('POST', url, body);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
