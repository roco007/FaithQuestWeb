import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // `web/` is its own Git repository nested inside the Expo project, so
  // Turbopack would otherwise walk up to the parent's package-lock.json and
  // warn that it is outside the current repository. Pinning the build root to
  // this directory keeps module resolution scoped to the web app.
  turbopack: {
    root: path.join(import.meta.dirname),
  },
  // Next.js blocks cross-origin requests to dev-only assets (HMR, chunks)
  // unless the requesting hostname is listed here. `localhost` and the
  // hostname the server was started with are always allowed, but that is not
  // how the app is opened while testing the AR camera: on a phone it is the
  // machine's LAN IP (`npm run dev -H 0.0.0.0`) or the HTTPS tunnel printed by
  // `npm run dev:tunnel`, which both need an explicit entry or the phone's
  // browser gets a stale page without HMR. Entries are hostnames only — no
  // scheme and no port. `*` matches exactly one label, so `192.168.*.*` covers
  // any home/office LAN.
  allowedDevOrigins: ['192.168.*.*', '192.168.0.105', '*.local', '*.trycloudflare.com'],
};

export default nextConfig;
