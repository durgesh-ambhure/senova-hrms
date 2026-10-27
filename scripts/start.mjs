/**
 * `npm start`: runs the whole project for local development — the dev MongoDB (when MONGODB_URI
 * points at it), the API and the web app — with prefixed output. Anything already listening on its
 * port is reused instead of started twice. Ctrl+C stops everything this script started.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const envFile = path.join(root, 'server/.env');
const env = fs.existsSync(envFile)
  ? Object.fromEntries(
      fs
        .readFileSync(envFile, 'utf8')
        .split(/\r?\n/)
        .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
    )
  : {};
if (!fs.existsSync(envFile)) console.warn('server/.env not found — copy server/.env.example first (see README).');

const dbPort = Number(env.DEV_DB_PORT ?? 27017);
const apiPort = Number(env.PORT ?? 4000);
const webPort = 5173;
const mongoUri = env.MONGODB_URI ?? '';
const usesDevDb = /^mongodb:\/\/(127\.0\.0\.1|localhost):\d+/.test(mongoUri) && mongoUri.includes(`:${dbPort}`);

const colors = { db: 35, api: 36, web: 32 };
const children = [];
let stopping = false;

const probe = (port, host) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });
// Vite binds "localhost", which is often IPv6 only, so check both loopback addresses.
const isListening = async (port) => (await probe(port, '127.0.0.1')) || probe(port, '::1');

async function waitFor(port, label, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await isListening(port)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not start listening on port ${port} within ${timeoutMs / 1000}s`);
}

function run(name, args) {
  const child = spawn('npm', args, { cwd: root, shell: process.platform === 'win32', env: process.env });
  const prefix = `\x1b[${colors[name]}m[${name}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) process.stdout.write(prefix + line + '\n');
    });
  }
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`${prefix}exited with code ${code}; stopping the rest.`);
      stop(code || 1);
    }
  });
  children.push(child);
  return child;
}

const running = () => children.filter((c) => c.exitCode === null && c.signalCode === null);

/**
 * Ctrl+C already reaches every process in the terminal, so each one (MongoDB included) gets the
 * chance to shut down cleanly first; whatever is still running after the grace period is killed.
 */
async function stop(code = 0, { graceful = false } = {}) {
  if (stopping) return;
  stopping = true;
  if (!graceful) for (const child of running()) if (process.platform !== 'win32') child.kill('SIGINT');
  const until = Date.now() + (graceful || process.platform !== 'win32' ? 10_000 : 0);
  while (running().length && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
  for (const child of running()) {
    // npm runs the real process as a grandchild; on Windows only taskkill /T reaches it.
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  }
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => stop(0, { graceful: true }));
process.on('SIGTERM', () => stop(0));

async function service(name, port, args, readyTimeoutMs) {
  if (await isListening(port)) {
    console.log(`[${name}] port ${port} is already in use — reusing what is running there.`);
    return;
  }
  run(name, args);
  await waitFor(port, name, readyTimeoutMs);
}

try {
  if (usesDevDb) await service('db', dbPort, ['run', 'db:dev'], 10 * 60_000); // first run downloads MongoDB
  else console.log('[db] MONGODB_URI is not the local dev database — not starting one.');
  await service('api', apiPort, ['run', 'dev:server'], 60_000);
  await service('web', webPort, ['run', 'dev:client'], 60_000);
  console.log(`\nSenova HRMS is running: http://localhost:${webPort}  (API http://localhost:${apiPort})  ·  Ctrl+C to stop\n`);
} catch (err) {
  console.error(err.message);
  stop(1);
}
