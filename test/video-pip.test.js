import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoPiP } from '../public/js/video-pip.js';

function setup(supported = true) {
  const oldMediaStream = globalThis.MediaStream;
  const oldDocumentPiP = globalThis.documentPictureInPicture;
  const remote = { kind: 'video', readyState: 'live', id: 'remote' };
  const local = { kind: 'video', readyState: 'live', id: 'local' };
  const audio = { kind: 'audio', readyState: 'live', id: 'audio' };
  const source = (track) => ({
    srcObject: { getVideoTracks: () => track ? [track] : [], getAudioTracks: () => [audio] },
  });
  const sources = { 'remote-main': source(remote), 'local-main': source(local) };
  const active = { 'remote-main': true, 'local-main': true };
  const windows = [];
  const errors = [];

  globalThis.MediaStream = class {
    constructor(tracks) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks.filter((item) => item.kind === 'audio'); }
    getVideoTracks() { return this.tracks.filter((item) => item.kind === 'video'); }
  };

  if (supported) {
    globalThis.documentPictureInPicture = {
      requestWindow(options) {
        const listeners = [];
        const win = {
          closed: false,
          options,
          document: {
            title: '',
            head: { append() {} },
            body: { append(el) { this.video = el; } },
            createElement(tag) {
              if (tag === 'video') {
                return { autoplay: false, muted: false, play: () => Promise.resolve() };
              }
              return { rel: '', href: '' };
            },
          },
          addEventListener(type, listener) { if (type === 'pagehide') listeners.push(listener); },
          close() {
            if (this.closed) return;
            this.closed = true;
            for (const listener of listeners) listener();
          },
        };
        windows.push(win);
        return Promise.resolve(win);
      },
    };
  } else {
    delete globalThis.documentPictureInPicture;
  }
  const manager = createVideoPiP({ sources, isActive: (key) => active[key] !== false,
    onError: (message) => errors.push(message) });
  return {
    manager, sources, active, windows, errors, remote, local, audio,
    restore() {
      manager.destroy();
      if (oldMediaStream === undefined) delete globalThis.MediaStream;
      else globalThis.MediaStream = oldMediaStream;
      if (oldDocumentPiP === undefined) delete globalThis.documentPictureInPicture;
      else globalThis.documentPictureInPicture = oldDocumentPiP;
    },
  };
}

test('abre um único PiP por aba, troca a fonte sem alterar o player original e sem áudio duplicado', async () => {
  const ctx = setup();
  try {
    assert.equal(ctx.manager.supported, true);
    await ctx.manager.toggle('remote-main');
    assert.equal(ctx.windows.length, 1);
    assert.equal(ctx.manager.selectedKey, 'remote-main');
    const video = ctx.windows[0].document.body.video;
    assert.equal(video.srcObject.getVideoTracks()[0], ctx.remote);
    assert.equal(video.srcObject.getAudioTracks().length, 0);
    assert.equal(video.muted, true);
    assert.equal(ctx.sources['remote-main'].srcObject.getVideoTracks()[0], ctx.remote);

    await ctx.manager.toggle('local-main');
    assert.equal(ctx.windows.length, 1);
    assert.equal(ctx.manager.selectedKey, 'local-main');
    assert.equal(video.srcObject.getVideoTracks()[0], ctx.local);

    await ctx.manager.toggle('local-main');
    assert.equal(ctx.windows[0].closed, true);
    assert.equal(ctx.manager.selectedKey, null);
    assert.equal(ctx.sources['local-main'].srcObject.getVideoTracks()[0], ctx.local);
  } finally {
    ctx.restore();
  }
});

test('PiP fica fixo no feed selecionado quando outro vídeo ganha destaque', async () => {
  const ctx = setup();
  try {
    await ctx.manager.toggle('remote-main');
    // Nenhuma referência ao foco do palco: trocar o destaque não altera o PiP.
    ctx.manager.sync();
    assert.equal(ctx.manager.selectedKey, 'remote-main');
    assert.equal(ctx.windows[0].document.body.video.srcObject.getVideoTracks()[0], ctx.remote);
  } finally { ctx.restore(); }
});

test('se a fonte for interrompida, fecha apenas a janela PiP', async () => {
  const ctx = setup();
  try {
    await ctx.manager.toggle('remote-main');
    ctx.remote.readyState = 'ended';
    ctx.manager.sync();
    assert.equal(ctx.windows[0].closed, true);
    assert.equal(ctx.manager.selectedKey, null);
    assert.equal(ctx.sources['local-main'].srcObject.getVideoTracks()[0], ctx.local);
    await ctx.manager.toggle('local-main');
    ctx.windows[1].close();
    assert.equal(ctx.manager.selectedKey, null);
  } finally { ctx.restore(); }
});

test('sem API PiP não cria janela e informa indisponibilidade', async () => {
  const ctx = setup(false);
  try {
    assert.equal(ctx.manager.supported, false);
    await ctx.manager.toggle('remote-main');
    assert.equal(ctx.windows.length, 0);
    assert.equal(ctx.errors.length, 1);
  } finally { ctx.restore(); }
});

test('PiP fecha quando a câmera remota é desligada mesmo que a trilha WebRTC siga viva', async () => {
  const ctx = setup();
  try {
    await ctx.manager.toggle('remote-main');
    assert.equal(ctx.remote.readyState, 'live');
    ctx.active['remote-main'] = false;
    ctx.manager.sync();
    assert.equal(ctx.windows[0].closed, true);
    assert.equal(ctx.manager.selectedKey, null);
    assert.equal(ctx.remote.readyState, 'live');
  } finally { ctx.restore(); }
});
