import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');

export const CLOUDFLARED_PATH = process.env.CLOUDFLARED_BIN
  || path.join(ROOT_DIR, 'bin', 'cloudflared');

const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

export function startTunnel({ port, onUrl, onError }) {
  if (!fs.existsSync(CLOUDFLARED_PATH)) {
    onError(new Error(
      `cloudflared não encontrado em ${CLOUDFLARED_PATH}. Rode ./start.sh para baixá-lo.`,
    ));
    return null;
  }

  let discovered = false;
  let child;

  try {
    child = spawn(
      CLOUDFLARED_PATH,
      ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    onError(error);
    return null;
  }

  function handleOutput(buffer) {
    if (discovered) return;
    const match = buffer.toString().match(TUNNEL_URL_PATTERN);
    if (!match) return;
    discovered = true;
    onUrl(match[0]);
  }

  child.stdout.on('data', handleOutput);
  child.stderr.on('data', handleOutput);

  child.on('error', (error) => {
    onError(error);
  });

  child.on('exit', (code, signal) => {
    if (discovered) return;
    onError(new Error(
      `cloudflared encerrou (${signal || `código ${code}`}) antes de criar o link público.`,
    ));
  });

  return child;
}