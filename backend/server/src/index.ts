#!/usr/bin/env -S node --enable-source-maps
// Standalone entry point: `npm start` (or the Docker image's CMD, N09) runs
// this directly. Reads configuration from the environment, wires
// backend/core's seams, and serves the four sync/auth endpoints plus
// /v1/meta and /v1/health over plain node:http.

import { bootstrap } from './lib/bootstrap';
import { createServerStack } from './server';
import { WS_PATH, wsEnabled } from './lib/ws-config';

async function main(): Promise<void> {
  const { domain, closeStore } = await bootstrap();
  const port = Number(process.env.PORT ?? 8787);
  const stack = createServerStack(domain);

  await new Promise<void>((resolve) => stack.server.listen(port, resolve));
  // eslint-disable-next-line no-console
  console.log(
    `cornertasks-server listening on :${port} (audience domain: ${domain.domainName}; ` +
      `websocket: ${wsEnabled() ? WS_PATH : 'disabled (CT_WS=off)'})`
  );

  const shutdown = (signal: string): void => {
    // eslint-disable-next-line no-console
    console.log(`cornertasks-server: received ${signal}, shutting down`);
    // `stack.close()` closes live sockets first — an open WebSocket otherwise
    // keeps `http.Server.close()` from ever calling back, and the container
    // would sit until Docker's SIGKILL.
    void stack.close().then(() => {
      closeStore();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('cornertasks-server: failed to start:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
