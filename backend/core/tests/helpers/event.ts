import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export function fakeEvent(opts: {
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}): APIGatewayProxyEventV2 {
  const headers = { ...(opts.headers ?? {}) };
  return {
    version: '2.0',
    routeKey: `${opts.method} ${opts.path}`,
    rawPath: opts.path,
    rawQueryString: '',
    headers,
    queryStringParameters: opts.query,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    requestContext: {
      accountId: '000000000000',
      apiId: 'test',
      domainName: 'test.execute-api.local',
      domainPrefix: 'test',
      http: {
        method: opts.method,
        path: opts.path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'jest'
      },
      requestId: 'req-1',
      routeKey: `${opts.method} ${opts.path}`,
      stage: 'test',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0
    },
    isBase64Encoded: false
  } as APIGatewayProxyEventV2;
}

export function asStructured(r: unknown): APIGatewayProxyStructuredResultV2 {
  return r as APIGatewayProxyStructuredResultV2;
}

export function parseJson(r: APIGatewayProxyStructuredResultV2): unknown {
  return JSON.parse(r.body!);
}
