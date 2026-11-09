import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev`        → plain HTTP (fine for desktop / localhost camera).
// `npm run dev:https`  → self-signed HTTPS so the phone camera (barcode scanner)
//   works when testing over the LAN. getUserMedia needs a secure context, which is
//   HTTPS or localhost - plain http://<lan-ip> is blocked by the browser.
//   Accept the one-time cert warning on the device. The /api proxy still targets the
//   plain-HTTP backend server-side, so there's no mixed-content issue in the browser.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: {
    host: true,
    port: 5174,
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } },
  },
}));

