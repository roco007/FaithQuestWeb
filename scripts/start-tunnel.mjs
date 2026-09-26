/**
 * Builds the production bundle, serves it with `next start`, and exposes it
 * over HTTPS via a Cloudflare quick tunnel for testing on a real phone.
 *
 * Why this exists (vs `npm run dev:tunnel`): `next dev` compiles routes on
 * demand and ships unminified chunks — over a tunnel on a phone the page can
 * render long before its JavaScript hydrates, so every button looks dead.
 * The production server responds with small prebuilt chunks, which keeps the
 * phone experience identical to a deployed build.
 *
 * Usage:
 *   npm run start:tunnel              # build, then serve + tunnel
 *   npm run start:tunnel -- --no-build  # reuse the existing .next build
 *   npm run start:tunnel -- --port 4000
 *
 * Prints the https://*.trycloudflare.com URL to open on the phone.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';

const argv = process.argv.slice(2);
const portIndex = argv.findIndex((a) => a === '--port' || a === '-p');
const port =
  portIndex >= 0 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : Number(process.env.PORT) || 3136;
const skipBuild = argv.includes('--no-build');

const TUNNEL_READY_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

function have(bin) {
  return new Promise((resolve) => {
    const p = spawn(bin, ['--version'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

/** Runs a command to completion; rejects on non-zero exit. */
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}

/** Resolves once something accepts a TCP connection on the port. */
function waitForPort(target, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port: target, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        if (Date.now() > deadline) {
          reject(new Error('Next.js production server did not start in time'));
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
    '\n[start:tunnel] cloudflared is not installed.\n' +
      '  Install it with:  brew install cloudflared\n' +
      '  Then re-run:      npm run start:tunnel\n'
  );
  process.exit(1);
}

if (!skipBuild) {
  console.log('[start:tunnel] building production bundle …');
  await run('npx', ['next', 'build']);
}

console.log(`[start:tunnel] starting Next.js (production) on :${port} …`);

const next = spawn('npx', ['next', 'start', '-p', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env },
});
children.push(next);
next.stdout.on('data', (d) => process.stdout.write(d));
next.stderr.on('data', (d) => process.stderr.write(d));
next.on('close', (code) => shutdown(code ?? 0));

await waitForPort(port);
console.log('[start:tunnel] production server is up — opening HTTPS tunnel …\n');

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
        '  Serving the production build (fast, hydrates immediately).\n' +
        '  This URL changes every time you restart the tunnel.\n' +
        '  Press Ctrl+C to stop both processes.\n'
    );
  }
}
tunnel.stdout.on('data', watchTunnelOutput);
tunnel.stderr.on('data', watchTunnelOutput);