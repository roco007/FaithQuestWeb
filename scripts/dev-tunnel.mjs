/**
 * Runs the Next.js dev server and exposes it over HTTPS via a Cloudflare
 * quick tunnel, so the app can be opened on a phone.
 *
 * Why this exists: browsers only allow Geolocation (and Camera, Clipboard and
 * Service Workers) in a secure context. `http://localhost:3000` qualifies, but
 * `http://192.168.x.x:3000` — how a phone reaches a dev server on the same
 * Wi-Fi — does not, so location silently fails on device. A tunnel gives the
 * same dev server a real public HTTPS origin, which qualifies.
 *
 * Usage:
 *   npm run dev:tunnel            # Next dev on :3000
 *   npm run dev:tunnel -- --port 4000
 *
 * Prints the https://*.trycloudflare.com URL to open on the phone.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';

const argv = process.argv.slice(2);
const portIndex = argv.findIndex((a) => a === '--port' || a === '-p');
const port =
  portIndex >= 0 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : Number(process.env.PORT) || 3000;

const TUNNEL_READY_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

function have(bin) {
  return new Promise((resolve) => {
    const p = spawn(bin, ['--version'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

/** Resolves once something accepts a TCP connection on the dev port. */
function waitForPort(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        if (Date.now() > deadline) {
          reject(new Error('Next dev server did not start in time'));
        } else {
          setTimeout(attempt, 300);
        }
      });
    };
    attempt();
  });
}

const children = [];
function shutdown(code = 0) {
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (!(await have('cloudflared'))) {
  console.error(
    '\n[dev:tunnel] cloudflared is not installed.\n' +
      '  Install it with:  brew install cloudflared\n' +
      '  Then re-run:      npm run dev:tunnel\n' +
      `\nAlternatives: deploy the app (Vercel/Netlify) or use \`ngrok http ${port}\`.\n`
  );
  process.exit(1);
}

console.log(`[dev:tunnel] starting Next.js on :${port} …`);

const next = spawn('npx', ['next', 'dev', '-p', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env },
});
children.push(next);
next.stdout.on('data', (d) => process.stdout.write(d));
next.stderr.on('data', (d) => process.stderr.write(d));
next.on('close', (code) => shutdown(code ?? 0));

// Only open the tunnel once the dev server is actually accepting connections,
// otherwise the first requests hit a not-yet-ready server.
await waitForPort(port);
console.log('[dev:tunnel] dev server is up — opening HTTPS tunnel …\n');

const tunnel = spawn(
  'cloudflared',
  ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);
children.push(tunnel);
tunnel.on('close', (code) => shutdown(code ?? 0));

// cloudflared logs everything — including the public URL — to STDERR, so both
// streams are scanned for it rather than just stdout.
let announced = false;
function watchTunnelOutput(chunk) {
  process.stderr.write(chunk);
  const match = String(chunk).match(TUNNEL_READY_URL);
  if (match && !announced) {
    announced = true;
    console.log(
      '\n' +
        '  ┌──────────────────────────────────────────────────────────────┐\n' +
        '  │  Open this HTTPS URL on your phone:                          │\n' +
        '  └──────────────────────────────────────────────────────────────┘\n' +
        `     ${match[0]}\n\n` +
        '  The phone can be on mobile data — it does not need the same Wi-Fi.\n' +
        '  This URL changes every time you restart the tunnel.\n' +
        '  Press Ctrl+C to stop both processes.\n'
    );
  }
}
tunnel.stdout.on('data', watchTunnelOutput);
tunnel.stderr.on('data', watchTunnelOutput);