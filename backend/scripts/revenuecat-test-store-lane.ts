import 'dotenv/config';
import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadRevenueCatTestStoreLaneConfig,
  runRevenueCatTestStoreLane,
  type TunnelInfo,
} from '../src/dev-tools/revenuecat-test-store-lane';

const NGROK_API_URL = 'http://127.0.0.1:4040/api/tunnels';
const PID_FILE = join(tmpdir(), 'stitch-wish-revenuecat-ngrok.pid');
const LOG_FILE = join(tmpdir(), 'stitch-wish-revenuecat-ngrok.log');

async function main(): Promise<void> {
  if (process.argv[2] === 'stop') {
    stopOwnedTunnel();
    return;
  }

  const config = loadRevenueCatTestStoreLaneConfig(process.env);
  await runRevenueCatTestStoreLane(config, {
    fetch,
    ensureTunnel,
    log: console.log,
  });
}

async function ensureTunnel(): Promise<TunnelInfo> {
  const existing = await discoverTunnel();
  if (existing) {
    console.log(`Reusing ngrok tunnel ${existing.publicUrl}`);
    return existing;
  }

  console.log('Starting ngrok HTTPS tunnel to local port 3000');
  const logDescriptor = openSync(LOG_FILE, 'a');
  const child = spawn('ngrok', ['http', '3000', '--log', 'stdout'], {
    detached: true,
    env: process.env,
    stdio: ['ignore', logDescriptor, logDescriptor],
  });
  child.unref();
  closeSync(logDescriptor);
  if (child.pid === undefined) {
    throw new Error('ngrok did not return a process id. Is ngrok installed?');
  }
  writeFileSync(PID_FILE, String(child.pid), { mode: 0o600 });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(500);
    const tunnel = await discoverTunnel();
    if (tunnel) return tunnel;
    if (!processIsRunning(child.pid)) {
      throw new Error(`ngrok exited before opening a tunnel. Inspect ${LOG_FILE}.`);
    }
  }
  throw new Error(`ngrok did not expose port 3000 within 10 seconds. Inspect ${LOG_FILE}.`);
}

async function discoverTunnel(): Promise<TunnelInfo | null> {
  let response: Response;
  try {
    response = await fetch(NGROK_API_URL);
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body = (await response.json()) as { tunnels?: unknown };
  if (!Array.isArray(body.tunnels)) return null;

  for (const candidate of body.tunnels) {
    if (candidate === null || typeof candidate !== 'object') continue;
    const tunnel = candidate as Record<string, unknown>;
    const config = tunnel.config;
    if (tunnel.proto !== 'https' || typeof tunnel.public_url !== 'string') continue;
    if (config === null || typeof config !== 'object') continue;
    const address = (config as Record<string, unknown>).addr;
    if (typeof address !== 'string' || localPort(address) !== 3000) continue;
    return { publicUrl: tunnel.public_url, localPort: 3000 };
  }
  return null;
}

function localPort(address: string): number | null {
  try {
    const url = new URL(address.includes('://') ? address : `http://${address}`);
    return Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  } catch {
    return null;
  }
}

function stopOwnedTunnel(): void {
  let pid: number;
  try {
    pid = Number(readFileSync(PID_FILE, 'utf8').trim());
  } catch {
    console.log('No ngrok process started by this workflow is recorded.');
    return;
  }
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    throw new Error(`Invalid ngrok pid file at ${PID_FILE}.`);
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Stopped ngrok process ${pid}.`);
  } catch (error: unknown) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code !== 'ESRCH') throw error;
    console.log(`ngrok process ${pid} was already stopped.`);
  } finally {
    unlinkSync(PID_FILE);
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
