import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind IPv4 wildcard only. `true` would bind the IPv6 wildcard (::) and
    // dual-stack to IPv4, which on macOS has been silently dropping LAN IPv4
    // connections in some setups. Explicit 0.0.0.0 sidesteps that entirely.
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Dev-only: accept any Host header (Vite 6 honors this; Vite 5 didn't).
    allowedHosts: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
});
