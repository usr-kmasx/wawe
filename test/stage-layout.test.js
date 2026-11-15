import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoStage } from '../public/js/stage-layout.js';

class FakeElement {
  constructor(name = 'div') {
    this.name = name;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = {};
    this.dataset = {};
    this.hidden = false;
    this.clientWidth = 900;
    this.clientHeight = 540;
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, enabled) => {
        if (enabled === undefined ? !classes.has(name) : enabled) classes.add(name);
        else classes.delete(name);
      },
    };
  }
  append(...children) {
    for (const child of children) child.parentElement = this;
    this.children.push(...children);
  }
  insertBefore(element) {
    element.parentElement = this;
    this.children.push(element);
  }
  closest(selector) {
    if (selector === '.stage-feed') {
      return this.classList.contains('stage-feed') ? this : this.parentElement?.closest(selector) || null;
    }
    if (selector.includes('.feed-')) {
      return selector.split(',').some((item) => item.trim().slice(1) === this.className) ? this : null;
    }
    return null;
  }
  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(fn);
  }
  removeEventListener(name, fn) {
    this.listeners.set(name, (this.listeners.get(name) || []).filter((listener) => listener !== fn));
  }
  dispatch(name, properties = {}) {
    const event = {
      target: this, button: 0, pointerId: 1, clientX: 0, clientY: 0,
      preventDefault() {}, stopPropagation() {},
      ...properties,
    };
    for (const listener of this.listeners.get(name) || []) listener(event);
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  setPointerCapture() {}
  releasePointerCapture() {}
}

function setup({ fakeClock = false, onPictureInPicture = null } = {}) {
  const previousDocument = globalThis.document;
  const previousObserver = globalThis.ResizeObserver;
  const oldSetTimeout = globalThis.setTimeout;
  const oldClearTimeout = globalThis.clearTimeout;
  const timers = new Map();
  let nextTimer = 0;
  if (fakeClock) {
    globalThis.setTimeout = (fn, delay) => {
      const id = ++nextTimer;
      timers.set(id, { fn, delay });
      return id;
    };
    globalThis.clearTimeout = (id) => timers.delete(id);
  }
  const documentElement = new FakeElement('document');
  documentElement.createElement = (tag) => new FakeElement(tag);
  globalThis.document = documentElement;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  const container = new FakeElement('stage');
  const remoteTile = new FakeElement('remote');
  const localTile = new FakeElement('local');
  const remoteMainVideo = new FakeElement('remote-main');
  const localMainVideo = new FakeElement('local-main');
  const remoteCameraVideo = new FakeElement('remote-camera');
  const localCameraVideo = new FakeElement('local-camera');
  const overlay = new FakeElement('overlay');
  container.append(remoteTile, localTile, overlay);
  const layout = createVideoStage({
    container, overlay, onPictureInPicture,
    tiles: {
      'remote-main': { tile: remoteTile, video: remoteMainVideo, label: new FakeElement() },
      'local-main': { tile: localTile, video: localMainVideo, label: new FakeElement() },
      'remote-camera': { video: remoteCameraVideo },
      'local-camera': { video: localCameraVideo },
    },
  });
  const byKey = (key) => container.children.find((item) => item.dataset?.feed === key)
    || (remoteTile.dataset.feed === key ? remoteTile : null)
    || (localTile.dataset.feed === key ? localTile : null);
  const tick = (milliseconds) => {
    for (const [id, timer] of [...timers]) {
      if (timer.delay > milliseconds || !timers.has(id)) continue;
      timers.delete(id);
      timer.fn();
    }
  };
  const close = () => {
    layout.destroy();
    globalThis.document = previousDocument;
    globalThis.ResizeObserver = previousObserver;
    globalThis.setTimeout = oldSetTimeout;
    globalThis.clearTimeout = oldClearTimeout;
  };
  const videos = {
    'remote-main': remoteMainVideo, 'local-main': localMainVideo,
    'remote-camera': remoteCameraVideo, 'local-camera': localCameraVideo,
  };
  return { layout, byKey, remoteTile, localTile, videos,
    documentElement, container, tick, close };
}

test('foco troca ao clicar e tela nova assume destaque, para host ou convidado', () => {
  const ctx = setup();
  try {
    const base = {
      'remote-main': { active: true, screen: false, label: 'Convidado' },
      'local-main': { active: true, screen: false, label: 'Você' },
    };
    ctx.layout.refresh(base);
    assert.equal(ctx.remoteTile.classList.contains('focused'), true);
    assert.equal(ctx.localTile.classList.contains('floating'), true);
    ctx.localTile.dispatch('click');
    assert.equal(ctx.localTile.classList.contains('focused'), true);
    ctx.layout.refresh({ ...base, 'remote-main': { ...base['remote-main'], screen: true } });
    assert.equal(ctx.remoteTile.classList.contains('focused'), true);
    ctx.localTile.dispatch('click');
    ctx.layout.refresh({ ...base, 'remote-main': { ...base['remote-main'], screen: true } });
    assert.equal(ctx.localTile.classList.contains('focused'), true);
  } finally { ctx.close(); }
});

test('câmera secundária permite alternar foco e desaparece ao parar a tela', () => {
  const ctx = setup();
  try {
    const local = {
      'local-main': { active: true, screen: true, label: 'Minha tela' },
      'local-camera': { active: true, screen: false, label: 'Minha câmera' },
    };
    ctx.layout.refresh(local);
    assert.equal(ctx.localTile.classList.contains('focused'), true);
    const cam = ctx.byKey('local-camera');
    assert.equal(cam.classList.contains('floating'), true);
    cam.dispatch('click');
    assert.equal(cam.classList.contains('focused'), true);
    ctx.layout.refresh({
      'local-main': { active: true, screen: false, label: 'Minha câmera' },
    });
    assert.equal(cam.hidden, true);
    assert.equal(ctx.localTile.classList.contains('focused'), true);
  } finally { ctx.close(); }
});

test('miniaturas podem ser movidas e redimensionadas sem sair do palco', () => {
  const ctx = setup();
  try {
    ctx.layout.refresh({
      'remote-main': { active: true, label: 'Convidado' },
      'local-main': { active: true, label: 'Você' },
    });
    const tile = ctx.localTile;
    const drag = tile.children.find((child) => child.className === 'feed-drag');
    const resize = tile.children.find((child) => child.className === 'feed-resize');
    const oldX = parseInt(tile.style.left, 10);
    drag.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    drag.dispatch('pointermove', { clientX: 60, clientY: 110 });
    drag.dispatch('pointerup');
    assert.ok(parseInt(tile.style.left, 10) < oldX);
    const oldWidth = parseInt(tile.style.width, 10);
    resize.dispatch('keydown', { key: 'ArrowRight' });
    assert.ok(parseInt(tile.style.width, 10) > oldWidth);
  } finally { ctx.close(); }
});

test('toque revela os controles por 3 segundos e primeiro toque não altera o foco', () => {
  const ctx = setup({ fakeClock: true });
  try {
    ctx.layout.refresh({
      'remote-main': { active: true, label: 'Convidado' },
      'local-main': { active: true, label: 'Você' },
    });
    assert.equal(ctx.localTile.classList.contains('controls-visible'), false);
    ctx.documentElement.dispatch('pointerdown', { pointerType: 'touch', target: ctx.localTile });
    assert.equal(ctx.localTile.classList.contains('controls-visible'), true);
    ctx.localTile.dispatch('click', { target: ctx.localTile });
    assert.equal(ctx.localTile.classList.contains('focused'), false);

    ctx.tick(2999);
    assert.equal(ctx.localTile.classList.contains('controls-visible'), true);
    ctx.tick(3000);
    assert.equal(ctx.localTile.classList.contains('controls-visible'), false);
    assert.equal(ctx.container.classList.contains('cursor-idle'), true);

    ctx.documentElement.dispatch('pointerdown', { pointerType: 'touch', target: ctx.localTile });
    ctx.localTile.dispatch('click', { target: ctx.localTile });
    assert.equal(ctx.localTile.classList.contains('focused'), false);
    ctx.documentElement.dispatch('pointerdown', { pointerType: 'touch', target: ctx.localTile });
    ctx.localTile.dispatch('click', { target: ctx.localTile });
    assert.equal(ctx.localTile.classList.contains('focused'), true);
  } finally { ctx.close(); }
});

test('toque fora fecha nomes, mover mouse reabre e inatividade esconde cursor', () => {
  const ctx = setup({ fakeClock: true });
  try {
    ctx.layout.refresh({
      'remote-main': { active: true, label: 'Convidado' },
      'local-main': { active: true, label: 'Você' },
    });
    ctx.documentElement.dispatch('pointerdown', { pointerType: 'touch', target: ctx.localTile });
    assert.equal(ctx.localTile.classList.contains('controls-visible'), true);
    ctx.documentElement.dispatch('pointerdown', { pointerType: 'touch', target: ctx.container });
    assert.equal(ctx.localTile.classList.contains('controls-visible'), false);

    ctx.container.dispatch('pointermove', { pointerType: 'mouse', target: ctx.localTile });
    assert.equal(ctx.localTile.classList.contains('controls-visible'), true);
    assert.equal(ctx.container.classList.contains('cursor-idle'), false);
    ctx.tick(3000);
    assert.equal(ctx.localTile.classList.contains('controls-visible'), false);
    assert.equal(ctx.container.classList.contains('cursor-idle'), true);

    ctx.container.dispatch('pointermove', { pointerType: 'mouse', target: ctx.localTile });
    assert.equal(ctx.container.classList.contains('cursor-idle'), false);
    ctx.documentElement.dispatch('keydown', { key: 'Escape' });
    assert.equal(ctx.localTile.classList.contains('controls-visible'), false);
  } finally { ctx.close(); }
});

test('botão de tela cheia aparece apenas no vídeo destacado e alterna o modo', async () => {
  const ctx = setup({ fakeClock: true });
  try {
    ctx.layout.refresh({
      'remote-main': { active: true, label: 'Convidado' },
      'local-main': { active: true, label: 'Você' },
    });
    const remoteButton = ctx.remoteTile.children.find((child) => child.className === 'feed-fullscreen');
    const localButton = ctx.localTile.children.find((child) => child.className === 'feed-fullscreen');
    assert.ok(remoteButton);
    assert.equal(remoteButton.hidden, false);
    assert.equal(localButton.hidden, true);
    assert.equal(remoteButton.attributes.get('aria-label'), 'Entrar em tela cheia');

    ctx.container.requestFullscreen = async () => {
      ctx.documentElement.fullscreenElement = ctx.container;
      ctx.documentElement.dispatch('fullscreenchange');
    };
    ctx.documentElement.exitFullscreen = async () => {
      ctx.documentElement.fullscreenElement = null;
      ctx.documentElement.dispatch('fullscreenchange');
    };

    remoteButton.dispatch('click', { target: remoteButton });
    await Promise.resolve();
    assert.equal(ctx.documentElement.fullscreenElement, ctx.container);
    assert.equal(remoteButton.attributes.get('aria-label'), 'Sair da tela cheia');
    assert.equal(remoteButton.attributes.get('aria-pressed'), 'true');
    assert.equal(ctx.remoteTile.classList.contains('focused'), true);
    assert.equal(ctx.localTile.hidden, false);
    assert.equal(ctx.localTile.classList.contains('floating'), true);
    assert.equal(ctx.remoteTile.parentElement, ctx.container);
    assert.equal(ctx.localTile.parentElement, ctx.container);
    // O foco pode ser trocado sem sair de tela cheia.
    ctx.localTile.dispatch('click', { target: ctx.localTile });
    assert.equal(ctx.documentElement.fullscreenElement, ctx.container);
    assert.equal(ctx.localTile.classList.contains('focused'), true);
    assert.equal(ctx.remoteTile.classList.contains('floating'), true);
    assert.equal(localButton.attributes.get('aria-label'), 'Sair da tela cheia');
    assert.equal(localButton.attributes.get('aria-pressed'), 'true');
    assert.equal(ctx.remoteTile.hidden, false);

    localButton.dispatch('click', { target: localButton });
    await Promise.resolve();
    assert.equal(ctx.documentElement.fullscreenElement, null);
    assert.equal(remoteButton.attributes.get('aria-pressed'), 'false');

    ctx.localTile.dispatch('click', { target: ctx.localTile });
    assert.equal(ctx.localTile.classList.contains('focused'), true);
    assert.equal(remoteButton.hidden, true);
    assert.equal(localButton.hidden, false);
  } finally {
    ctx.close();
  }
});

test('botões PiP escolhem só um feed e não alteram o destaque da sala', () => {
  const chosen = [];
  const ctx = setup({ onPictureInPicture: (key) => chosen.push(key) });
  try {
    ctx.layout.refresh({
      'remote-main': { active: true, screen: false, label: 'Convidado' },
      'local-main': { active: true, screen: false, label: 'Você' },
    });
    const remotePiP = ctx.remoteTile.children.find((child) => child.className === 'feed-pip');
    const localPiP = ctx.localTile.children.find((child) => child.className === 'feed-pip');
    assert.ok(remotePiP);
    assert.ok(localPiP);
    assert.equal(remotePiP.hidden, false);
    assert.equal(localPiP.hidden, false);
    remotePiP.dispatch('click', { target: remotePiP });
    localPiP.dispatch('click', { target: localPiP });
    assert.deepEqual(chosen, ['remote-main', 'local-main']);
    assert.equal(ctx.remoteTile.classList.contains('focused'), true);
    assert.equal(ctx.localTile.classList.contains('floating'), true);
    ctx.layout.refresh({ 'local-main': { active: true, label: 'Você' } });
    remotePiP.dispatch('click', { target: remotePiP });
    assert.deepEqual(chosen, ['remote-main', 'local-main']);
  } finally { ctx.close(); }
});

test('botão PiP não aparece quando o navegador não oferece suporte', () => {
  const ctx = setup();
  try {
    ctx.layout.refresh({ 'local-main': { active: true, label: 'Você' } });
    const button = ctx.localTile.children.find((child) => child.className === 'feed-pip');
    assert.ok(button);
    assert.equal(button.hidden, true);
  } finally { ctx.close(); }
});


function floatingRects(ctx) {
  return ['remote-main', 'local-main', 'remote-camera', 'local-camera']
    .map((key) => ctx.byKey(key))
    .filter((tile) => tile && !tile.hidden && tile.classList.contains('floating'))
    .map((tile) => ({
      key: tile.dataset.feed,
      x: Number.parseInt(tile.style.left, 10),
      y: Number.parseInt(tile.style.top, 10),
      w: Number.parseInt(tile.style.width, 10),
      h: Number.parseInt(tile.style.height, 10),
    }));
}

function assertNoOverlap(ctx) {
  const rects = floatingRects(ctx);
  for (const [i, a] of rects.entries()) {
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= ctx.container.clientWidth
      && a.y + a.h <= ctx.container.clientHeight, `${a.key} fora do palco`);
    for (const b of rects.slice(i + 1)) {
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x
        || a.y + a.h <= b.y || b.y + b.h <= a.y,
      `${a.key} e ${b.key} não podem se sobrepor`);
    }
  }
  return rects;
}

test('três miniaturas começam separadas, inclusive em palco reduzido', () => {
  const ctx = setup();
  try {
    const all = {
      'remote-main': { active: true, label: 'Tela remota' },
      'local-main': { active: true, label: 'Tela local' },
      'remote-camera': { active: true, label: 'Câmera remota' },
      'local-camera': { active: true, label: 'Câmera local' },
    };
    ctx.layout.refresh(all);
    assert.equal(assertNoOverlap(ctx).length, 3);
    ctx.container.clientWidth = 340;
    ctx.container.clientHeight = 215;
    ctx.layout.refresh(all);
    assert.equal(assertNoOverlap(ctx).length, 3);
    ctx.container.clientWidth = 250;
    ctx.container.clientHeight = 140;
    ctx.layout.refresh(all);
    assert.equal(assertNoOverlap(ctx).length, 3);
  } finally { ctx.close(); }
});

test('arrastar uma miniatura para cima de outra a mantém e empurra a outra', () => {
  const ctx = setup();
  try {
    const all = {
      'remote-main': { active: true, label: 'Tela remota' },
      'local-main': { active: true, label: 'Tela local' },
      'remote-camera': { active: true, label: 'Câmera remota' },
      'local-camera': { active: true, label: 'Câmera local' },
    };
    ctx.layout.refresh(all);
    const before = floatingRects(ctx);
    const movingTile = ctx.localTile;
    const drag = movingTile.children.find((child) => child.className === 'feed-drag');
    const target = before.find((pos) => pos.key === 'remote-camera');
    const start = before.find((pos) => pos.key === 'local-main');
    drag.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    drag.dispatch('pointermove', {
      clientX: 100 + target.x - start.x,
      clientY: 100 + target.y - start.y,
    });
    const after = assertNoOverlap(ctx);
    const moved = after.find((pos) => pos.key === 'local-main');
    const displaced = after.find((pos) => pos.key === 'remote-camera');
    assert.equal(moved.x, target.x, 'a miniatura arrastada deve conservar o destino');
    assert.equal(moved.y, target.y);
    assert.ok(displaced.x !== target.x || displaced.y !== target.y,
      'a miniatura ocupada precisa ser empurrada');
    drag.dispatch('pointerup');
    assertNoOverlap(ctx);
  } finally { ctx.close(); }
});

test('redimensionamento, troca de destaque e nova geometria não sobrepõem miniaturas', () => {
  const ctx = setup();
  try {
    const all = {
      'remote-main': { active: true, label: 'Tela remota' },
      'local-main': { active: true, label: 'Tela local' },
      'remote-camera': { active: true, label: 'Câmera remota' },
      'local-camera': { active: true, label: 'Câmera local' },
    };
    ctx.layout.refresh(all);
    const resize = ctx.localTile.children.find((child) => child.className === 'feed-resize');
    for (let i = 0; i < 16; i += 1) resize.dispatch('keydown', { key: 'ArrowRight' });
    assertNoOverlap(ctx);
    ctx.byKey('remote-camera').dispatch('click');
    assertNoOverlap(ctx);
    ctx.container.clientWidth = 420;
    ctx.container.clientHeight = 230;
    ctx.layout.refresh(all);
    assertNoOverlap(ctx);
    ctx.container.clientWidth = 1100;
    ctx.container.clientHeight = 740;
    ctx.documentElement.fullscreenElement = ctx.container;
    ctx.documentElement.dispatch('fullscreenchange');
    ctx.layout.refresh(all);
    assertNoOverlap(ctx);
    ctx.layout.refresh({ ...all, 'remote-camera': { active: false } });
    assertNoOverlap(ctx);
  } finally { ctx.close(); }
});

test('refluxo mantém separação em tamanhos variados do palco e alternância de foco', () => {
  const ctx = setup();
  try {
    const all = {
      'remote-main': { active: true, label: 'Tela remota' },
      'local-main': { active: true, label: 'Tela local' },
      'remote-camera': { active: true, label: 'Câmera remota' },
      'local-camera': { active: true, label: 'Câmera local' },
    };
    for (const w of [90, 120, 180, 240, 320, 390, 620, 900, 1280]) {
      for (const h of [50, 80, 120, 180, 270, 540, 768]) {
        ctx.container.clientWidth = w;
        ctx.container.clientHeight = h;
        ctx.layout.refresh(all);
        const places = assertNoOverlap(ctx);
        assert.equal(places.length, 3, `deve mostrar três miniaturas em ${w}x${h}`);
      }
    }
    ctx.byKey('local-camera').dispatch('click');
    assertNoOverlap(ctx);
  } finally { ctx.close(); }
});

test('miniaturas recuperam tamanho e posição preferidos após fechar e reabrir espaço', () => {
  const ctx = setup();
  try {
    const all = {
      'remote-main': { active: true, label: 'Tela remota' },
      'local-main': { active: true, label: 'Tela local' },
      'remote-camera': { active: true, label: 'Câmera remota' },
      'local-camera': { active: true, label: 'Câmera local' },
    };
    ctx.layout.refresh(all);
    const first = floatingRects(ctx);
    ctx.container.clientWidth = 120;
    ctx.container.clientHeight = 70;
    ctx.layout.refresh(all);
    const mini = assertNoOverlap(ctx);
    assert.ok(mini.some((pos) => pos.w < 100 || pos.h < 70));
    ctx.container.clientWidth = 900;
    ctx.container.clientHeight = 540;
    ctx.layout.refresh(all);
    const restored = assertNoOverlap(ctx);
    for (const original of first) {
      const current = restored.find((pos) => pos.key === original.key);
      assert.equal(current.w, original.w, `${original.key} recupera largura`);
      assert.equal(current.h, original.h, `${original.key} recupera altura`);
    }
  } finally { ctx.close(); }
});

function approxRatio(tile, ratio, label) {
  const w = Number.parseInt(tile.style.width, 10);
  const h = Number.parseInt(tile.style.height, 10);
  assert.ok(w > 0 && h > 0, `${label}: dimensões válidas`);
  assert.ok(Math.abs(w / h - ratio) <= Math.max(.02, 2 / h),
    `${label}: proporção esperada ${ratio}, encontrada ${w}/${h}`);
}

test('câmeras 4:3, 16:9 e retrato usam a proporção real da miniatura', () => {
  const ctx = setup();
  try {
    const base = {
      'remote-main': { active: true, label: 'Visitante', screen: false },
      'local-main': { active: true, label: 'Eu', screen: false },
    };
    ctx.videos['local-main'].videoWidth = 640;
    ctx.videos['local-main'].videoHeight = 480;
    ctx.layout.refresh(base);
    approxRatio(ctx.localTile, 4 / 3, '4:3');
    ctx.videos['local-main'].videoWidth = 1920;
    ctx.videos['local-main'].videoHeight = 1080;
    ctx.videos['local-main'].dispatch('resize');
    approxRatio(ctx.localTile, 16 / 9, '16:9 após mudança de resolução');
    ctx.videos['local-main'].videoWidth = 720;
    ctx.videos['local-main'].videoHeight = 1280;
    ctx.videos['local-main'].dispatch('loadedmetadata');
    approxRatio(ctx.localTile, 720 / 1280, 'câmera vertical');
    assertNoOverlap(ctx);
  } finally { ctx.close(); }
});

test('dimensões getSettings permitem ajustar a miniatura antes dos metadados', () => {
  const ctx = setup();
  try {
    ctx.videos['local-main'].srcObject = {
      getVideoTracks: () => [{ getSettings: () => ({ width: 1024, height: 768 }) }],
    };
    ctx.layout.refresh({
      'remote-main': { active: true, label: 'Visitante', screen: false },
      'local-main': { active: true, label: 'Eu', screen: false },
    });
    approxRatio(ctx.localTile, 4 / 3, 'getSettings');
  } finally { ctx.close(); }
});

test('redimensionar câmera respeita proporção, inclusive no teclado', () => {
  const ctx = setup();
  try {
    const video = ctx.videos['local-main'];
    video.videoWidth = 640;
    video.videoHeight = 480;
    ctx.layout.refresh({
      'remote-main': { active: true, label: 'Visitante', screen: false },
      'local-main': { active: true, label: 'Eu', screen: false },
    });
    const resize = ctx.localTile.children.find((child) => child.className === 'feed-resize');
    const initialWidth = Number.parseInt(ctx.localTile.style.width, 10);
    resize.dispatch('keydown', { key: 'ArrowRight' });
    assert.ok(Number.parseInt(ctx.localTile.style.width, 10) > initialWidth);
    approxRatio(ctx.localTile, 4 / 3, 'teclado horizontal');
    resize.dispatch('keydown', { key: 'ArrowDown' });
    approxRatio(ctx.localTile, 4 / 3, 'teclado vertical');
    resize.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    resize.dispatch('pointermove', { clientX: 142, clientY: 100 });
    approxRatio(ctx.localTile, 4 / 3, 'arrasto resize');
    resize.dispatch('pointerup');
    approxRatio(ctx.localTile, 4 / 3, 'após resize');
  } finally { ctx.close(); }
});

test('câmera em destaque fica centralizada no formato real; tela mantém palco inteiro', () => {
  const ctx = setup();
  try {
    const video = ctx.videos['remote-main'];
    video.videoWidth = 640;
    video.videoHeight = 480;
    const base = {
      'remote-main': { active: true, label: 'Visitante', screen: false },
      'local-main': { active: true, label: 'Eu', screen: false },
    };
    ctx.layout.refresh(base);
    assert.equal(ctx.remoteTile.classList.contains('focused'), true);
    approxRatio(ctx.remoteTile, 4 / 3, 'câmera em destaque');
    const x = Number.parseInt(ctx.remoteTile.style.left, 10);
    const y = Number.parseInt(ctx.remoteTile.style.top, 10);
    const w = Number.parseInt(ctx.remoteTile.style.width, 10);
    const h = Number.parseInt(ctx.remoteTile.style.height, 10);
    assert.ok(Math.abs(x - (ctx.container.clientWidth - w) / 2) <= 1);
    assert.ok(Math.abs(y - (ctx.container.clientHeight - h) / 2) <= 1);
    ctx.layout.refresh({ ...base, 'remote-main': { ...base['remote-main'], screen: true } });
    assert.equal(ctx.remoteTile.style.width, '', 'compartilhamento usa o palco principal');
    assert.equal(ctx.remoteTile.style.height, '');
    assert.equal(ctx.remoteTile.classList.contains('native-camera-ratio'), false);
  } finally { ctx.close(); }
});

test('três câmeras com proporções diferentes continuam separadas após estreitar janela', () => {
  const ctx = setup();
  try {
    const base = Object.fromEntries(['remote-main', 'local-main', 'remote-camera', 'local-camera']
      .map((key) => [key, { active: true, screen: false, label: key }]));
    for (const [key, w, h] of [
      ['local-main', 640, 480],
      ['remote-camera', 720, 1280],
      ['local-camera', 1920, 1080],
    ]) {
      ctx.videos[key].videoWidth = w;
      ctx.videos[key].videoHeight = h;
    }
    for (const [w, h] of [[900, 540], [620, 300], [390, 250], [240, 180]]) {
      ctx.container.clientWidth = w;
      ctx.container.clientHeight = h;
      ctx.layout.refresh(base);
      const items = assertNoOverlap(ctx);
      assert.equal(items.length, 3);
      for (const item of items) {
        const video = ctx.videos[item.key];
        assert.ok(Math.abs(item.w / item.h - video.videoWidth / video.videoHeight)
          < Math.max(.09, 2 / item.h), `${item.key}: proporção preservada em ${w}x${h}`);
      }
    }
  } finally { ctx.close(); }
});

test('limite manual de largura 120px vale para câmera com mouse e teclado', () => {
  const ctx = setup();
  try {
    ctx.videos['local-main'].videoWidth = 1920;
    ctx.videos['local-main'].videoHeight = 1080;
    ctx.layout.refresh({
      'remote-main': { active: true, screen: false, label: 'Convidado' },
      'local-main': { active: true, screen: false, label: 'Você' },
    });
    const tile = ctx.localTile;
    const resize = tile.children.find((child) => child.className === 'feed-resize');
    for (let i = 0; i < 30; i += 1) resize.dispatch('keydown', { key: 'ArrowLeft' });
    let width = Number.parseInt(tile.style.width, 10);
    assert.equal(width, 120, 'seta não permite diminuir a miniatura abaixo de 120px');
    approxRatio(tile, 16 / 9, 'limite mínimo de câmera 16:9');
    resize.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    resize.dispatch('pointermove', { clientX: -900, clientY: 100 });
    resize.dispatch('pointerup');
    width = Number.parseInt(tile.style.width, 10);
    assert.equal(width, 120, 'arrastar não permite reduzir abaixo de 120px');
    approxRatio(tile, 16 / 9, 'mínimo após arrastar');
  } finally { ctx.close(); }
});

test('limite manual de 120px também vale para miniatura de tela compartilhada', () => {
  const ctx = setup();
  try {
    ctx.layout.refresh({
      'remote-main': { active: true, screen: false, label: 'Convidado' },
      'local-main': { active: true, screen: true, label: 'Minha tela' },
    });
    const tile = ctx.remoteTile;
    const resize = tile.children.find((child) => child.className === 'feed-resize');
    for (let i = 0; i < 30; i += 1) resize.dispatch('keydown', { key: 'ArrowLeft' });
    assert.equal(Number.parseInt(tile.style.width, 10), 120);
    resize.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    resize.dispatch('pointermove', { clientX: -1000, clientY: -1000 });
    resize.dispatch('pointerup');
    assert.equal(Number.parseInt(tile.style.width, 10), 120);
  } finally { ctx.close(); }
});

test('três miniaturas priorizam reorganização mantendo 120px quando há espaço', () => {
  const ctx = setup();
  try {
    for (const video of Object.values(ctx.videos)) {
      video.videoWidth = 1920;
      video.videoHeight = 1080;
    }
    const all = Object.fromEntries(Object.keys(ctx.videos).map((key) => [key,
      { active: true, screen: false, label: key }]));
    ctx.container.clientWidth = 390;
    ctx.container.clientHeight = 220;
    ctx.layout.refresh(all);
    let positions = assertNoOverlap(ctx);
    assert.equal(positions.length, 3);
    assert.ok(positions.every((item) => item.w >= 120), 'deve organizar antes de encolher');
    ctx.container.clientWidth = 500;
    ctx.container.clientHeight = 280;
    ctx.layout.refresh(all);
    positions = assertNoOverlap(ctx);
    assert.ok(positions.every((item) => item.w >= 120));
  } finally { ctx.close(); }
});

test('em palco fisicamente inviável aceita redução temporária sem encobrir outras', () => {
  const ctx = setup();
  try {
    for (const video of Object.values(ctx.videos)) {
      video.videoWidth = 1920;
      video.videoHeight = 1080;
    }
    const all = Object.fromEntries(Object.keys(ctx.videos).map((key) => [key,
      { active: true, screen: false, label: key }]));
    ctx.container.clientWidth = 170;
    ctx.container.clientHeight = 100;
    ctx.layout.refresh(all);
    let positions = assertNoOverlap(ctx);
    assert.equal(positions.length, 3);
    assert.ok(positions.some((item) => item.w < 120), 'não existe espaço para 3x120px');
    ctx.container.clientWidth = 1000;
    ctx.container.clientHeight = 700;
    ctx.layout.refresh(all);
    positions = assertNoOverlap(ctx);
    assert.ok(positions.every((item) => item.w >= 120), 'recupera tamanho assim que couber');
  } finally { ctx.close(); }
});

test('miniatura movida para canto inferior direito segue a borda ao entrar e sair de fullscreen', () => {
  const ctx = setup();
  try {
    const active = {
      'remote-main': { active: true, label: 'Host' },
      'local-main': { active: true, label: 'Visitante' },
    };
    ctx.layout.refresh(active);
    const drag = ctx.localTile.children.find((item) => item.className === 'feed-drag');
    const get = () => floatingRects(ctx).find((item) => item.key === 'local-main');
    const initial = get();
    const right = ctx.container.clientWidth - 16 - initial.w;
    const bottom = ctx.container.clientHeight - 16 - initial.h;
    drag.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    drag.dispatch('pointermove', {
      clientX: 100 + right - initial.x,
      clientY: 100 + bottom - initial.y,
    });
    drag.dispatch('pointerup');
    assert.equal(get().x, right);
    assert.equal(get().y, bottom);

    ctx.container.clientWidth = 1360;
    ctx.container.clientHeight = 768;
    ctx.documentElement.fullscreenElement = ctx.container;
    ctx.documentElement.dispatch('fullscreenchange');
    const full = get();
    assert.equal(full.x + full.w, ctx.container.clientWidth - 16);
    assert.equal(full.y + full.h, ctx.container.clientHeight - 16);
    assertNoOverlap(ctx);

    ctx.container.clientWidth = 900;
    ctx.container.clientHeight = 540;
    ctx.documentElement.fullscreenElement = null;
    ctx.documentElement.dispatch('fullscreenchange');
    assert.deepEqual(get(), { ...initial, x: right, y: bottom });
  } finally { ctx.close(); }
});

test('miniatura posicionada manualmente no meio preserva a posição relativa no fullscreen', () => {
  const ctx = setup();
  try {
    ctx.layout.refresh({
      'remote-main': { active: true, label: 'Host' },
      'local-main': { active: true, label: 'Visitante' },
    });
    const drag = ctx.localTile.children.find((item) => item.className === 'feed-drag');
    const get = () => floatingRects(ctx).find((item) => item.key === 'local-main');
    const initial = get();
    const target = {
      x: Math.round(16 + (900 - 32 - initial.w) * .4),
      y: Math.round(16 + (540 - 32 - initial.h) * .65),
    };
    drag.dispatch('pointerdown', { clientX: 50, clientY: 50 });
    drag.dispatch('pointermove', {
      clientX: 50 + target.x - initial.x,
      clientY: 50 + target.y - initial.y,
    });
    drag.dispatch('pointerup');
    const after = get();
    const rx = (after.x - 16) / (900 - 32 - after.w);
    const ry = (after.y - 16) / (540 - 32 - after.h);

    ctx.container.clientWidth = 1600;
    ctx.container.clientHeight = 900;
    ctx.documentElement.fullscreenElement = ctx.container;
    ctx.documentElement.dispatch('fullscreenchange');
    const full = get();
    assert.ok(Math.abs(full.x - (16 + rx * (1600 - 32 - full.w))) <= 1);
    assert.ok(Math.abs(full.y - (16 + ry * (900 - 32 - full.h))) <= 1);
    assertNoOverlap(ctx);

    ctx.container.clientWidth = 900;
    ctx.container.clientHeight = 540;
    ctx.documentElement.fullscreenElement = null;
    ctx.documentElement.dispatch('fullscreenchange');
    assert.deepEqual(get(), after);
  } finally { ctx.close(); }
});

test('canto esquerdo superior permanece ancorado durante fullscreen e mudança de destaque', () => {
  const ctx = setup();
  try {
    const active = {
      'remote-main': { active: true, label: 'Host' },
      'local-main': { active: true, label: 'Visitante' },
    };
    ctx.layout.refresh(active);
    const drag = ctx.localTile.children.find((item) => item.className === 'feed-drag');
    const get = () => floatingRects(ctx).find((item) => item.key === 'local-main');
    const initial = get();
    drag.dispatch('pointerdown', { clientX: 50, clientY: 50 });
    drag.dispatch('pointermove', { clientX: 50 + 16 - initial.x, clientY: 50 });
    drag.dispatch('pointerup');
    assert.equal(get().x, 16);
    assert.equal(get().y, 16);
    ctx.localTile.dispatch('click', { target: ctx.localTile });
    assert.equal(ctx.localTile.classList.contains('focused'), true);
    ctx.remoteTile.dispatch('click', { target: ctx.remoteTile });
    ctx.container.clientWidth = 1440;
    ctx.container.clientHeight = 810;
    ctx.documentElement.fullscreenElement = ctx.container;
    ctx.documentElement.dispatch('fullscreenchange');
    assert.equal(get().x, 16);
    assert.equal(get().y, 16);
    assertNoOverlap(ctx);
  } finally { ctx.close(); }
});

test('redimensionar miniatura encaixada no canto mantém ancoragem no fullscreen', () => {
  const ctx = setup();
  try {
    ctx.videos['local-main'].videoWidth = 1920;
    ctx.videos['local-main'].videoHeight = 1080;
    ctx.layout.refresh({
      'remote-main': { active: true, label: 'Host' },
      'local-main': { active: true, label: 'Minha câmera' },
    });
    const get = () => floatingRects(ctx).find((item) => item.key === 'local-main');
    const drag = ctx.localTile.children.find((item) => item.className === 'feed-drag');
    const resize = ctx.localTile.children.find((item) => item.className === 'feed-resize');
    const initial = get();
    drag.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    drag.dispatch('pointermove', {
      clientX: 100,
      clientY: 100 + (540 - 16 - initial.h - initial.y),
    });
    drag.dispatch('pointerup');
    assert.equal(get().y + get().h, 540 - 16);
    for (let i = 0; i < 6; i += 1) resize.dispatch('keydown', { key: 'ArrowLeft' });
    const afterResize = get();
    assert.ok(afterResize.w < initial.w);
    assert.equal(afterResize.x + afterResize.w, 900 - 16);
    assert.equal(afterResize.y + afterResize.h, 540 - 16);

    ctx.container.clientWidth = 1360;
    ctx.container.clientHeight = 768;
    ctx.documentElement.fullscreenElement = ctx.container;
    ctx.documentElement.dispatch('fullscreenchange');
    const fullscreen = get();
    assert.equal(fullscreen.x + fullscreen.w, 1360 - 16);
    assert.equal(fullscreen.y + fullscreen.h, 768 - 16);
    assert.equal(fullscreen.w, afterResize.w);
    approxRatio(ctx.localTile, 16 / 9, 'resized fullscreen camera');
  } finally { ctx.close(); }
});
