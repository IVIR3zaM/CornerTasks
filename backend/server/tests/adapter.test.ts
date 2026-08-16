// Unit tests for the adapter: does it build an `HttpEvent` that matches what
// API Gateway's HttpApi (v2) payload would produce, in the fields the core
// handlers actually read? Exercised over a real socket (not a hand-mocked
// `IncomingMessage`) so header/body parsing behaves exactly as it will in
// production.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildEvent, readBody, writeResult, MAX_BODY_BYTES, type DomainContext } from '../src/adapter';
import type { HttpEvent } from '../../core/src/types/http';

const DOMAIN: DomainContext = { domainName: 'ct-server-test.example', stage: '' };

async function withCaptureServer(
  fn: (baseUrl: string) => Promise<void>
): Promise<HttpEvent> {
  let captured!: HttpEvent;
  const server: Server = createServer(async (req, res) => {
    const { body } = await readBody(req);
    captured = buildEvent(req, body, DOMAIN);
    writeResult(res, { statusCode: 200, body: 'ok' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return captured;
}

test('lowercases header keys, as API Gateway does', async () => {
  const event = await withCaptureServer(async (baseUrl) => {
    await fetch(`${baseUrl}/v1/sync/pull`, {
      headers: { Authorization: 'Bearer abc', 'X-Custom-Header': 'yes' }
    });
  });
  expect(event.headers?.authorization).toBe('Bearer abc');
  expect(event.headers?.['x-custom-header']).toBe('yes');
  expect(event.headers?.Authorization).toBeUndefined();
});

test('queryStringParameters is {} (never undefined) when there is no query string', async () => {
  const event = await withCaptureServer(async (baseUrl) => {
    await fetch(`${baseUrl}/v1/meta`);
  });
  expect(event.queryStringParameters).toEqual({});
});

test('queryStringParameters reflects the parsed URL', async () => {
  const event = await withCaptureServer(async (baseUrl) => {
    await fetch(`${baseUrl}/v1/sync/pull?accountDid=did%3Akey%3Az123&cursor=42`);
  });
  expect(event.queryStringParameters).toEqual({ accountDid: 'did:key:z123', cursor: '42' });
});

test('body is the raw string, undefined when empty', async () => {
  const withBody = await withCaptureServer(async (baseUrl) => {
    await fetch(`${baseUrl}/v1/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountDid: 'did:key:zTest' })
    });
  });
  expect(withBody.body).toBe(JSON.stringify({ accountDid: 'did:key:zTest' }));

  const withoutBody = await withCaptureServer(async (baseUrl) => {
    await fetch(`${baseUrl}/v1/health`);
  });
  expect(withoutBody.body).toBeUndefined();
});

test('requestContext.http.{method,path} are populated from the request', async () => {
  const event = await withCaptureServer(async (baseUrl) => {
    await fetch(`${baseUrl}/v1/sync/push?ignored=1`, { method: 'POST', body: '{}' });
  });
  expect(event.requestContext.http.method).toBe('POST');
  expect(event.requestContext.http.path).toBe('/v1/sync/push');
});

test('requestContext.domainName/stage come from the injected domain, not the request Host header', async () => {
  const event = await withCaptureServer(async (baseUrl) => {
    await fetch(`${baseUrl}/v1/health`);
  });
  expect(event.requestContext.domainName).toBe(DOMAIN.domainName);
  expect(event.requestContext.stage).toBe(DOMAIN.stage);
});

test('readBody reports tooLarge for bodies over the 1 MB cap and does not buffer them', async () => {
  const server = createServer(async (req, res) => {
    const { body, tooLarge } = await readBody(req);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ tooLarge, len: body.length }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const oversized = 'x'.repeat(MAX_BODY_BYTES + 10);
    const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: oversized });
    const json = (await res.json()) as { tooLarge: boolean; len: number };
    expect(json.tooLarge).toBe(true);
    expect(json.len).toBe(0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('readBody accepts a body right at the cap', async () => {
  const server = createServer(async (req, res) => {
    const { body, tooLarge } = await readBody(req);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ tooLarge, len: body.length }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const exact = 'x'.repeat(MAX_BODY_BYTES);
    const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: exact });
    const json = (await res.json()) as { tooLarge: boolean; len: number };
    expect(json.tooLarge).toBe(false);
    expect(json.len).toBe(MAX_BODY_BYTES);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('writeResult sends the status code, headers, and body verbatim', async () => {
  const server = createServer((_req, res) => {
    writeResult(res, { statusCode: 201, headers: { 'x-test': 'yes' }, body: 'hello' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(201);
    expect(res.headers.get('x-test')).toBe('yes');
    expect(await res.text()).toBe('hello');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
