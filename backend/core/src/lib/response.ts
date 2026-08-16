import type { HttpResult } from '../types/http';
import type { ApiError } from '../types/api';

export function json(
  statusCode: number,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): HttpResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body)
  };
}

export function errorResponse(
  statusCode: number,
  error: ApiError['error'],
  reason: string,
  details: string | null = null
): HttpResult {
  const headers: Record<string, string> = {};
  if (statusCode === 401) headers['WWW-Authenticate'] = 'Bearer realm="cornertasks"';
  return json(statusCode, { error, reason, details } satisfies ApiError, headers);
}
