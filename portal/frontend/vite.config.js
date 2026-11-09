import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import http from 'node:http';

// Dev proxy: don't reuse keep-alive sockets to the backend. A restart under
// `node --watch` can leave a pooled socket half-closed, and the next request then
// fails with ECONNRESET.
const agent = new http.Agent({ keepAlive: false });

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind all interfaces (0.0.0.0) so the dev server is reachable both at
    // http://localhost:5173 AND at the machine's LAN/VPN IP (Vite prints both as
    // "Local:" and "Network:" on startup). VPN clients are effectively on the LAN,
    // so this keeps the Portal LAN-only - do NOT port-forward this to the WAN.
    host: true,
    port: 5173,
    // Allow internal hostnames (not just the IP), e.g. http://portal.lan:5173.
    allowedHosts: ['.lan', '.local', 'localhost'],
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        agent,
      },
    },
  },
});
