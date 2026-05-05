import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handler as push } from '../src/handlers/push';
import { handler as pull } from '../src/handlers/pull';

function fakeEvent(method: string, path: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '000000000000',
      apiId: 'test',
      domainName: 'test.execute-api.local',
      domainPrefix: 'test',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'jest'
      },
      requestId: 'req-1',
      routeKey: `${method} ${path}`,
      stage: 'test',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0
    },
    isBase64Encoded: false
  } as APIGatewayProxyEventV2;
}

function asStructured(r: unknown): APIGatewayProxyStructuredResultV2 {
  return r as APIGatewayProxyStructuredResultV2;
}

describe('handler skeletons', () => {
  test('push returns 200 with placeholder body', async () => {
    const res = asStructured(await push(fakeEvent('POST', '/v1/sync/push')));
    expect(res.statusCode).toBe(200);
    expect(res.headers?.['content-type']).toBe('application/json');
    expect(JSON.parse(res.body!)).toEqual({ ok: true, todo: 'iteration 5', route: 'push' });
  });

  test('pull returns 200 with placeholder body', async () => {
    const res = asStructured(await pull(fakeEvent('GET', '/v1/sync/pull')));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toEqual({ ok: true, todo: 'iteration 5', route: 'pull' });
  });
});
