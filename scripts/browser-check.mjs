#!/usr/bin/env node
/**
 * Verificação de navegador (opcional), isolada:
 * - sobe o servidor em uma porta aleatória, sem túnel;
 * - abre duas abas no Chromium headless com microfone/câmera falsos;
 * - testa criação de sala, entrada do convidado, chat, mic, câmera,
 *   compartilhamento de tela (getDisplayMedia simulado) e saída do convidado.
 *
 * Uso: npm run test:browser
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

const CHROME_BIN = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT || 9333);
const PROFILE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'wawe-browser-check-'));
const ROOM_PASSWORD = 'senha-e2e';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(description, fn, { timeout = 12_000, interval = 120 } = {}) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeout) {
    try {
      const value = await fn();
      if (value) return value;
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }

  throw new Error(
    `Timeout aguardando ${description}${lastError ? ` (${lastError.message})` : ''}`,
  );
}

const instance = createApp({
  publicState: { publicUrl: 'https://exemplo.trycloudflare.com', tunnel: 'custom' },
  hostGraceMs: 2000,
  guestGraceMs: 2000,
  trustCloudflare: false,
});

await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${instance.server.address().port}`;

const chrome = spawn(CHROME_BIN, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--disable-features=WebRtcHideLocalIpsWithMdns',
  '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--remote-debugging-port=${DEBUG_PORT}`,
  '--remote-allow-origins=*',
  `--user-data-dir=${PROFILE_DIR}`,
  'about:blank',
], { stdio: 'ignore' });

let socket;

try {
  const version = await waitFor('DevTools do Chromium', async () => {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    return response.ok ? response.json() : null;
  }, { timeout: 20_000 });

  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }

    if (message.method === 'Page.javascriptDialogOpening') {
      send('Page.handleJavaScriptDialog', { accept: true }, message.sessionId)
        .catch(() => {});
    }
  });

  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = (nextId += 1);
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }));
    });
  }

  async function newPage(url) {
    const { targetId } = await send('Target.createTarget', { url });
    const { sessionId } = await send('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    return { targetId, sessionId };
  }

  async function evaluate(page, expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, page.sessionId);

    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text;
      throw new Error(`Erro no navegador: ${description}`);
    }
    return result.result.value;
  }

  async function navigate(page, path) {
    await send('Page.navigate', { url: `${base}${path}` }, page.sessionId);
    await waitFor(`carregar ${path}`, async () => {
      return (await evaluate(page, 'document.readyState')) === 'complete';
    });
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  const created = await (async () => {
    const hostPage = await newPage(`${base}/`);
    await waitFor('home do host', async () => {
      return evaluate(hostPage, `document.readyState === 'complete' && location.origin === ${JSON.stringify(base)}`);
    });

    const room = await evaluate(hostPage, `(async () => {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roomName: 'Sala E2E',
          hostName: 'Participante A',
          password: ${JSON.stringify(ROOM_PASSWORD)},
        }),
      });
      const data = await response.json();
      sessionStorage.setItem('wawe:session:' + data.code, JSON.stringify({
        token: data.token,
        role: data.role,
        name: data.hostName,
        roomName: data.roomName,
      }));
      return data;
    })()`);

    await navigate(hostPage, `/room.html?room=${room.code}`);
    return { hostPage, room };
  })();

  await evaluate(created.hostPage, `(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value) => { window.__inviteCopied = value; } },
    });
    document.getElementById('copy-link').click();
    return true;
  })()`);
  await waitFor('botão superior copia o convite com atalho /CODIGO', async () => {
    const value = await evaluate(created.hostPage, 'window.__inviteCopied || null');
    return value === `https://exemplo.trycloudflare.com/${created.room.code}`;
  });
  assert(
    await evaluate(created.hostPage, `!document.getElementById('share-box')
      && !document.getElementById('share-link')
      && !document.getElementById('share-copy')`),
    'A seção inferior de compartilhamento deve ter sido removida',
  );

  assert(
    await evaluate(created.hostPage, `!document.getElementById('qr-box') && !document.getElementById('qr-image')`),
    'QR Code foi removido da interface',
  );

  const guestPage = await newPage(`${base}/`);
  await waitFor('home do convidado', async () => {
    return evaluate(guestPage, `document.readyState === 'complete' && location.origin === ${JSON.stringify(base)}`);
  });

  await evaluate(guestPage, `(async () => {
    const response = await fetch('/api/rooms/${created.room.code}/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Participante B', password: ${JSON.stringify(ROOM_PASSWORD)} }),
    });
    const data = await response.json();
    sessionStorage.setItem('wawe:session:' + data.code, JSON.stringify({
      token: data.token,
      role: data.role,
      name: 'Participante B',
      roomName: data.roomName,
    }));
    return data;
  })()`);

  await navigate(guestPage, `/room.html?room=${created.room.code}`);

  const { hostPage } = created;

  await waitFor('host ver Participante B', async () => {
    const label = await evaluate(hostPage, 'document.getElementById("remote-label").textContent');
    return label.includes('Participante B');
  });

  await waitFor('convidado ver Participante A', async () => {
    const label = await evaluate(guestPage, 'document.getElementById("remote-label").textContent');
    return label.includes('Participante A');
  });

  await waitFor('conexão WebRTC no host', async () => {
    const state = await evaluate(
      hostPage,
      'document.querySelector("#conn-status .status-label").textContent',
    );
    return state === 'conectado';
  }, { timeout: 20_000 });

  await waitFor('conexão WebRTC no convidado', async () => {
    const state = await evaluate(
      guestPage,
      'document.querySelector("#conn-status .status-label").textContent',
    );
    return state === 'conectado';
  }, { timeout: 20_000 });

  await evaluate(hostPage, `(() => {
    const input = document.getElementById('chat-input');
    input.value = 'olá do host';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('chat-form').requestSubmit();
    return true;
  })()`);

  await waitFor('chat chegar no convidado', async () => {
    const text = await evaluate(guestPage, 'document.getElementById("messages").textContent');
    return text.includes('olá do host');
  });

  await evaluate(hostPage, `(() => {
    const button = document.getElementById('quality-toggle');
    button.click();
    const select = document.getElementById('screen-quality');
    select.value = 'balanced';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor('controle de qualidade do host', async () => {
    return (await evaluate(hostPage, 'document.getElementById("quality-status").textContent'))
      .includes('Perfil solicitado');
  });
  assert(
    await evaluate(guestPage, 'Boolean(document.getElementById("quality-toggle"))'),
    'convidado também deve ter controle da qualidade da própria transmissão',
  );

  // Alterar FPS e resolução individualmente muda o seletor para Personalizado.
  await evaluate(hostPage, `(() => {
    const fps = document.getElementById('screen-fps');
    fps.value = '60';
    fps.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor('60 FPS personalizados na tela do host', async () => {
    return evaluate(hostPage, `(() => {
      const raw = JSON.parse(localStorage.getItem('wawe:video-quality') || '{}');
      return document.getElementById('screen-quality').value === 'custom'
        && raw.screen?.fps === 60 && raw.screen?.height === 720;
    })()`);
  });

  await evaluate(hostPage, `(() => {
    const resolution = document.getElementById('screen-resolution');
    resolution.value = '1080';
    resolution.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor('1080p/60 FPS personalizados no host', async () => {
    return evaluate(hostPage, `(() => {
      const raw = JSON.parse(localStorage.getItem('wawe:video-quality') || '{}');
      return raw.screen?.preset === 'custom'
        && raw.screen?.height === 1080 && raw.screen?.fps === 60;
    })()`);
  });

  await evaluate(hostPage, `(() => {
    const preset = document.getElementById('screen-quality');
    preset.value = 'high';
    preset.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor('preset Alta restaurado no host', async () => {
    return evaluate(hostPage, `(() => {
      const raw = JSON.parse(localStorage.getItem('wawe:video-quality') || '{}');
      return raw.screen?.preset === 'high' && raw.screen?.fps === 60
        && document.getElementById('screen-fps').value === '60';
    })()`);
  });

  await evaluate(hostPage, 'document.getElementById("mic").click(); true');
  await waitFor('microfone do host ligado', async () => {
    return (await evaluate(hostPage, 'document.getElementById("mic").getAttribute("aria-pressed")')) === 'true';
  });

  await waitFor('convidado ver mic do host ligado', async () => {
    const chips = await evaluate(guestPage, 'document.getElementById("remote-chips").textContent');
    return !chips.includes('mudo');
  });

  await evaluate(hostPage, 'document.getElementById("cam").click(); true');
  await waitFor('câmera do host ligada', async () => {
    return (await evaluate(hostPage, 'document.getElementById("cam").getAttribute("aria-pressed")')) === 'true';
  });

  await waitFor('vídeo remoto chegando no convidado', async () => {
    return evaluate(guestPage, `(() => {
      const video = document.getElementById('remote-video');
      return Boolean(video.srcObject && video.srcObject.getVideoTracks().length > 0);
    })()`);
  }, { timeout: 15_000 });

  assert(await evaluate(guestPage, `(() => {
    const focused = document.getElementById('remote-tile');
    const button = focused.querySelector('.feed-fullscreen');
    const miniButton = document.getElementById('local-tile').querySelector('.feed-fullscreen');
    return focused.classList.contains('focused') && !button.hidden && miniButton.hidden
      && getComputedStyle(button).right === '12px'
      && getComputedStyle(button).bottom === '12px'
      && button.getAttribute('aria-label') === 'Entrar em tela cheia';
  })()`), 'O botão de tela cheia deve existir no canto inferior direito do vídeo destacado');


  // A tela cheia amplia o palco todo: a miniatura e o vídeo destacado continuam juntos.
  await evaluate(guestPage, 'document.getElementById("cam").click(); true');
  await waitFor('miniatura local ativa no convidado', () => evaluate(guestPage,
    'document.getElementById("cam").getAttribute("aria-pressed") === "true" && !document.getElementById("local-tile").hidden'));
  await send('Runtime.evaluate', {
    expression: 'document.querySelector("#remote-tile .feed-fullscreen").click(); true',
    userGesture: true,
    returnByValue: true,
  }, guestPage.sessionId);
  await waitFor('palco, e não tile, em tela cheia', () => evaluate(guestPage,
    'document.fullscreenElement === document.querySelector(".videos")'));
  assert(await evaluate(guestPage, '(() => {'
    + ' const stage=document.querySelector(".videos").getBoundingClientRect();'
    + ' const thumb=document.getElementById("local-tile");'
    + ' const rect=thumb.getBoundingClientRect();'
    + ' return thumb.classList.contains("floating") && !thumb.hidden'
    + ' && getComputedStyle(thumb).display!=="none" && rect.width>0 && rect.height>0'
    + ' && rect.left>=stage.left && rect.top>=stage.top && rect.right<=stage.right && rect.bottom<=stage.bottom;'
    + ' })()'), 'Miniatura continua visível dentro do palco em tela cheia');
  await evaluate(guestPage, 'document.getElementById("local-tile").click(); true');
  assert(await evaluate(guestPage,
    'document.fullscreenElement===document.querySelector(".videos")'
    + ' && document.getElementById("local-tile").classList.contains("focused")'
    + ' && !document.getElementById("remote-tile").hidden'),
    'Alternar foco mantém tela cheia e miniaturas');
  await evaluate(guestPage, 'document.exitFullscreen()');
  await waitFor('sair da tela cheia', () => evaluate(guestPage, 'document.fullscreenElement===null'));
  await evaluate(guestPage, 'document.getElementById("cam").click(); true');
  await waitFor('restaurar câmera do convidado', () => evaluate(guestPage,
    'document.getElementById("cam").getAttribute("aria-pressed")==="false"'));

  // Usa viewport e interface touch de celular para validar a versão responsiva.
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  }, hostPage.sessionId);
  await send('Emulation.setTouchEmulationEnabled', {
    enabled: true, maxTouchPoints: 1,
  }, hostPage.sessionId);

  assert(await evaluate(hostPage, `(() => {
    const camera = document.getElementById('local-video');
    const remoteCamera = document.getElementById('remote-camera-video');
    const auxCamera = document.getElementById('local-camera-video');
    const tile = document.getElementById('local-tile');
    return [camera, remoteCamera, auxCamera].every((video) =>
      getComputedStyle(video).objectFit === 'contain'
      && getComputedStyle(video).backgroundColor === 'rgb(0, 0, 0)')
      && getComputedStyle(tile).backgroundColor === 'rgb(0, 0, 0)';
  })()`), 'Câmeras no celular devem preservar proporção e usar bordas pretas');

  // Simula eventos de toque em uma miniatura: o primeiro toque revela controles,
  // mas não destaca a câmera. Em 3 s, nomes e controles devem desaparecer.
  const touchState = await evaluate(hostPage, `(() => {
    const tile = document.getElementById('local-tile');
    tile.dispatchEvent(new PointerEvent('pointerdown', {
      pointerType: 'touch', bubbles: true, cancelable: true,
    }));
    tile.click();
    return {
      visible: tile.classList.contains('controls-visible'),
      focused: tile.classList.contains('focused'),
    };
  })()`);
  assert(touchState.visible && !touchState.focused,
    'Primeiro toque deve abrir controles sem alterar o destaque');
  await waitFor('controles ficam visíveis ao toque', async () => {
    return evaluate(hostPage, `getComputedStyle(
      document.querySelector('#local-tile .feed-drag')
    ).visibility === 'visible'`);
  });

  await waitFor('controles ocultados após 3 s de inatividade', async () => {
    return evaluate(hostPage, `(() => {
      const stage = document.querySelector('.videos');
      const tile = document.getElementById('local-tile');
      return stage.classList.contains('cursor-idle')
        && !tile.classList.contains('controls-visible')
        && getComputedStyle(tile.querySelector('.feed-drag')).visibility === 'hidden';
    })()`);
  }, { timeout: 6500 });

  assert(await evaluate(hostPage, `(() => {
    const stage = document.querySelector('.videos');
    const tile = document.getElementById('local-tile');
    tile.dispatchEvent(new PointerEvent('pointermove', {
      pointerType: 'mouse', bubbles: true, cancelable: true,
    }));
    const open = tile.classList.contains('controls-visible')
      && !stage.classList.contains('cursor-idle');
    document.querySelector('.side').dispatchEvent(new PointerEvent('pointerdown', {
      pointerType: 'touch', bubbles: true,
    }));
    return open && !tile.classList.contains('controls-visible');
  })()`), 'Mouse deve revelar controles; toque fora deve escondê-los');

  await send('Emulation.setTouchEmulationEnabled', { enabled: false }, hostPage.sessionId);
  await send('Emulation.clearDeviceMetricsOverride', {}, hostPage.sessionId);

  await evaluate(hostPage, `(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext('2d');
    context.fillStyle = '#2b2d31';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const audioContext = new AudioContext();
    const audioDestination = audioContext.createMediaStreamDestination();
    const oscillator = audioContext.createOscillator();
    oscillator.frequency.value = 440;
    oscillator.connect(audioDestination);
    oscillator.start();
    const stream = new MediaStream([
      ...canvas.captureStream(10).getVideoTracks(),
      ...audioDestination.stream.getAudioTracks(),
    ]);
    window.__testScreenAudio = { audioContext, oscillator };
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async () => stream,
    });
    return true;
  })()`);

  assert(
    await evaluate(hostPage, `!document.getElementById('include-screen-audio')
      && !document.getElementById('screen-audio-status')`),
    'Som da tela é solicitado automaticamente, sem opção ou mensagem extra na interface',
  );
  await evaluate(hostPage, 'document.getElementById("share").click(); true');
  await waitFor('tela compartilhada', async () => {
    return (await evaluate(hostPage, 'document.getElementById("share").getAttribute("aria-pressed")')) === 'true';
  });

  await waitFor('convidado ver a tela sem indicadores redundantes', async () => {
    return evaluate(guestPage, `(() => {
      return document.getElementById('remote-video').classList.contains('screen')
        && !document.getElementById('remote-chips').textContent.includes('som da tela')
        && !document.getElementById('remote-chips').textContent.includes('tela');
    })()`);
  });
  await waitFor('som chegar ao convidado por WebRTC', async () => {
    return evaluate(guestPage, `(() => {
      const stream = document.getElementById('remote-audio').srcObject;
      return Boolean(stream?.getAudioTracks().length);
    })()`);
  });

  // O áudio da tela deve sobreviver ao mute do microfone, sem depender da câmera.
  await evaluate(hostPage, 'document.getElementById("mic").click(); true');
  await waitFor('microfone desligado durante compartilhamento', async () => {
    return (await evaluate(hostPage, 'document.getElementById("mic").getAttribute("aria-pressed")')) === 'false';
  });
  await waitFor('áudio compartilhado continua sem microfone', async () => {
    return evaluate(guestPage, `(() => {
      const audio = document.getElementById('remote-audio').srcObject;
      const chips = document.getElementById('remote-chips').textContent;
      return document.getElementById('remote-video').classList.contains('screen')
        && Boolean(audio?.getAudioTracks().length) && !chips.includes('mudo');
    })()`);
  });
  await waitFor('amostras reais do som da tela chegam ao convidado', async () => {
    return evaluate(guestPage, `(async () => {
      const stream = document.getElementById('remote-audio').srcObject;
      if (!stream?.getAudioTracks().length) return false;
      if (!window.__testAudioMeter) {
        const context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        await context.resume();
        window.__testAudioMeter = { context, source, analyser };
      }
      const buffer = new Float32Array(1024);
      window.__testAudioMeter.analyser.getFloatTimeDomainData(buffer);
      return buffer.some((sample) => Math.abs(sample) > 0.01);
    })()`);
  }, { timeout: 15_000 });
  await evaluate(hostPage, 'document.getElementById("mic").click(); true');
  await waitFor('microfone religado com áudio da tela', async () => {
    return (await evaluate(hostPage, 'document.getElementById("mic").getAttribute("aria-pressed")')) === 'true';
  });

  await evaluate(hostPage, 'document.getElementById("share").click(); true');
  await waitFor('tela parada', async () => {
    return (await evaluate(hostPage, 'document.getElementById("share").getAttribute("aria-pressed")')) === 'false';
  });

  await evaluate(guestPage, `(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    const oscillator = audioContext.createOscillator();
    oscillator.frequency.value = 660;
    oscillator.connect(destination);
    oscillator.start();
    window.__testGuestAudio = { audioContext, oscillator };
    const stream = new MediaStream([
      ...canvas.captureStream(10).getVideoTracks(),
      ...destination.stream.getAudioTracks(),
    ]);
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async () => stream,
    });
    return true;
  })()`);
  await evaluate(guestPage, 'document.getElementById("share").click(); true');
  await waitFor('convidado compartilhando a tela', async () => {
    return (await evaluate(guestPage, 'document.getElementById("share").getAttribute("aria-pressed")')) === 'true';
  });
  await waitFor('host vendo tela e áudio do convidado', async () => {
    return evaluate(hostPage, `(() => {
      return document.getElementById('remote-video').classList.contains('screen')
        && !document.getElementById('remote-chips').textContent.includes('som da tela')
        && !document.getElementById('remote-chips').textContent.includes('tela');
    })()`);
  });
  await waitFor('trilha de áudio do convidado chegando ao host', async () => {
    return evaluate(hostPage, `(() => {
      const stream = document.getElementById('remote-audio').srcObject;
      return Boolean(stream?.getAudioTracks().length);
    })()`);
  });
  await evaluate(guestPage, 'document.getElementById("share").click(); true');
  await waitFor('convidado parou de compartilhar a tela', async () => {
    return (await evaluate(guestPage, 'document.getElementById("share").getAttribute("aria-pressed")')) === 'false';
  });

  await evaluate(hostPage, 'document.getElementById("lock").click(); true');
  await waitFor('convidado recebe aviso de sala trancada', async () => {
    const toast = await evaluate(guestPage, 'document.getElementById("toast").textContent');
    return toast.includes('trancada');
  });

  await evaluate(guestPage, 'document.getElementById("leave").click(); true');
  await waitFor('host volta a aguardar', async () => {
    const label = await evaluate(hostPage, 'document.getElementById("remote-label").textContent');
    return label.includes('Aguardando');
  });

  assert(
    await evaluate(hostPage, 'document.getElementById("overlay").hidden'),
    'prévia local da câmera deve ficar visível quando o convidado sai',
  );

  console.log('✔ navegador: sala, WebRTC, chat, mic, câmera, tela+áudio dos dois participantes (amostras recebidas), qualidade, trancar e saída');
} finally {
  try {
    socket?.close();
  } catch {
    // ignore
  }
  chrome.kill('SIGTERM');
  await instance.close();
  await fs.rm(PROFILE_DIR, { recursive: true, force: true }).catch(() => {});
}