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

function setup({ fakeClock = false } = {}) {
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
  const remoteCameraVideo = new FakeElement('remote-camera');
  const localCameraVideo = new FakeElement('local-camera');
  const overlay = new FakeElement('overlay');
  container.append(remoteTile, localTile, overlay);
  const layout = createVideoStage({
    container, overlay,
    tiles: {
      'remote-main': { tile: remoteTile, video: new FakeElement(), label: new FakeElement() },
      'local-main': { tile: localTile, video: new FakeElement(), label: new FakeElement() },
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
  return { layout, byKey, remoteTile, localTile, documentElement, container, tick, close };
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
