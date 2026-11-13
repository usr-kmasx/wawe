import { spawn } from 'node:child_process';

import { createApp } from './app.js';
import { config } from './config.js';
import { startTunnel } from './tunnel.js';

const publicState = {
  publicUrl: config.publicUrl || null,
  tunnel: config.publicUrl ? 'custom' : config.tunnel ? 'starting' : 'off',
};

const instance = createApp({
  publicState,
  hostGraceMs: config.hostGraceMs,
  guestGraceMs: config.guestGraceMs,
  roomTtlMs: config.roomTtlMs,
  trustCloudflare: config.trustCloudflare,
});

let tunnelProcess = null;
let shuttingDown = false;

function openBrowser(url) {
  if (process.env.NO_OPEN === '1') return;

  const platform = process.platform;
  const command = platform === 'darwin'
    ? 'open'
    : platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];

  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Sem navegador disponível: o link já foi impresso no terminal.
  }
}

async function listenOnAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 10; port += 1) {
    const result = await new Promise((resolve) => {
      const onError = (error) => {
        instance.server.off('listening', onListening);
        resolve(error);
      };
      const onListening = () => {
        instance.server.off('error', onError);
        resolve(null);
      };

      instance.server.once('error', onError);
      instance.server.once('listening', onListening);
      instance.server.listen(port, config.host);
    });

    if (!result) return port;
    if (result.code !== 'EADDRINUSE') throw result;
  }

  throw new Error(`Nenhuma porta livre entre ${startPort} e ${startPort + 9}.`);
}

async function main() {
  const port = await listenOnAvailablePort(config.port);
  const localUrl = `http://localhost:${port}`;

  console.log('');
  console.log('  wawe · sala privada');
  console.log(`  local:  ${localUrl}`);

  if (config.publicUrl) {
    console.log(`  público: ${config.publicUrl} (domínio próprio)`);
    console.log('');
    console.log('  Crie uma sala para gerar o link de convite.');
    console.log('  Enquanto este processo estiver rodando, a sala fica no ar.');
  } else if (config.tunnel) {
    tunnelProcess = startTunnel({
      port,
      onUrl: (url) => {
        publicState.publicUrl = url;
        publicState.tunnel = 'up';
        console.log(`  público: ${url}`);
        console.log('');
        console.log('  Crie uma sala para gerar o link de convite.');
        console.log('  Enquanto este processo estiver rodando, a sala fica no ar.');
      },
      onError: (error) => {
        publicState.tunnel = 'error';
        publicState.publicUrl = null;
        console.warn(`  túnel: ${error.message}`);
        console.warn('  a sala continua acessível apenas localmente.');
      },
    });
  } else {
    publicState.tunnel = 'off';
    console.log('  túnel: desativado (TUNNEL=0)');
  }

  openBrowser(localUrl);

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n  encerrando (${signal})...`);

    if (tunnelProcess) {
      try {
        tunnelProcess.kill('SIGTERM');
      } catch {
        // já encerrado
      }
    }

    try {
      await instance.close();
    } catch {
      // encerramento best-effort
    }
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(`\n  erro: ${error.message}\n`);
  process.exit(1);
});