import test from 'node:test';
import assert from 'node:assert/strict';
import { OutgoingAudio } from '../public/js/outgoing-audio.js';
import { PeerSession } from '../public/js/rtc.js';

class FakeTrack {
  constructor(kind) {
    this.kind = kind;
    this.readyState = 'live';
    this.enabled = true;
    this.listeners = new Map();
  }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  stop() {
    this.readyState = 'ended';
    this.listeners.get('ended')?.();
  }
}

class FakeStream {
  constructor(tracks = []) { this.tracks = tracks; }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video'); }
  getTracks() { return this.tracks; }
}

function usingGlobals(run) {
  const originals = new Map();
  for (const key of ['MediaStream', 'AudioContext', 'webkitAudioContext', 'navigator']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  const set = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, value });
  const restore = () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
  set('MediaStream', FakeStream);
  return Promise.resolve().then(() => run({ set })).finally(restore);
}

test('som da tela é enviado sem precisar habilitar o microfone', () => usingGlobals(async ({ set }) => {
  const screenVideo = new FakeTrack('video');
  const screenAudio = new FakeTrack('audio');
  let constraints;
  const errors = [];
  set('navigator', { mediaDevices: {
    getDisplayMedia: async (options) => {
      constraints = options;
      return new FakeStream([screenVideo, screenAudio]);
    },
  } });

  const audioSent = [];
  const rtc = new PeerSession({
    socket: { connected: true, emit() {} },
    callbacks: { onError: (error) => errors.push(error) },
  });
  rtc.senders.audio = { replaceTrack: async (track) => audioSent.push(track) };
  rtc.senders.video = { replaceTrack: async () => {} };
  assert.equal(rtc.mediaState.mic, false);
  await rtc.startScreen({ includeAudio: true });
  assert.equal(constraints.audio, true);
  assert.equal(constraints.systemAudio, 'include');
  assert.equal(rtc.mediaState.screen, true);
  assert.equal(rtc.mediaState.screenAudio, true);
  assert.equal(rtc.mediaState.mic, false);
  assert.equal(audioSent.at(-1), screenAudio);
  assert.deepEqual(errors, []);

  await rtc.stopScreen();
  assert.equal(screenVideo.readyState, 'ended');
  assert.equal(screenAudio.readyState, 'ended');
  assert.equal(audioSent.at(-1), null);
  assert.equal(rtc.mediaState.screenAudio, false);
}));

test('Web Audio mistura microfone e som da tela, sem reprodução local', () => usingGlobals(async ({ set }) => {
  const contextInstances = [];
  class FakeAudioContext {
    constructor() {
      this.connected = [];
      this.closed = false;
      this.output = new FakeTrack('audio');
      contextInstances.push(this);
    }
    createMediaStreamDestination() {
      return { stream: new FakeStream([this.output]) };
    }
    createMediaStreamSource(stream) {
      return {
        connect: (dest) => this.connected.push({ track: stream.getAudioTracks()[0], dest }),
        disconnect() {},
      };
    }
    resume() { return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
  }
  set('AudioContext', FakeAudioContext);
  const mic = new FakeTrack('audio');
  const screen = new FakeTrack('audio');
  const mixer = new OutgoingAudio();

  assert.equal(mixer.getTrack(mic, null), mic);
  const mixed = mixer.getTrack(mic, screen);
  assert.equal(mixed.kind, 'audio');
  assert.notEqual(mixed, mic);
  assert.notEqual(mixed, screen);
  assert.deepEqual(contextInstances[0].connected.map((x) => x.track), [mic, screen]);
  assert.equal(mixer.getTrack(mic, screen), mixed);
  assert.equal(contextInstances.length, 1);
  assert.equal(mixer.getTrack(null, screen), screen);
  assert.equal(contextInstances[0].closed, true);
  mixer.release();
}));

test('sem suporte a mixagem, som da tela tem prioridade e microfone fica independente', () => usingGlobals(async ({ set }) => {
  set('AudioContext', undefined);
  set('webkitAudioContext', undefined);
  let warnings = 0;
  const mixer = new OutgoingAudio({ onMixUnavailable: () => { warnings++; } });
  const mic = new FakeTrack('audio');
  const screen = new FakeTrack('audio');
  assert.equal(mixer.getTrack(mic, screen), screen);
  assert.equal(warnings, 1);
  assert.equal(mixer.getTrack(mic, null), mic);
}));

test('fonte sem áudio mantém vídeo, informa limitação e não exige microfone', () => usingGlobals(async ({ set }) => {
  const video = new FakeTrack('video');
  let options;
  const warnings = [];
  set('navigator', { mediaDevices: { getDisplayMedia: async (requested) => {
    options = requested;
    return new FakeStream([video]);
  } } });
  const rtc = new PeerSession({
    socket: { connected: false },
    callbacks: { onError: (message) => warnings.push(message) },
  });
  rtc.senders.video = { replaceTrack: async () => {} };
  rtc.senders.audio = { replaceTrack: async () => {} };
  await rtc.startScreen({ includeAudio: true });
  assert.equal(options.audio, true);
  assert.equal(rtc.mediaState.screen, true);
  assert.equal(rtc.mediaState.screenAudio, false);
  assert.equal(warnings.length, 1);
  await rtc.stopScreen();
}));

test('opção sem som não solicita áudio ao navegador', () => usingGlobals(async ({ set }) => {
  let options;
  set('navigator', { mediaDevices: { getDisplayMedia: async (requested) => {
    options = requested;
    return new FakeStream([new FakeTrack('video')]);
  } } });
  const warnings = [];
  const rtc = new PeerSession({
    socket: { connected: false },
    callbacks: { onError: (message) => warnings.push(message) },
  });
  await rtc.startScreen({ includeAudio: false });
  assert.equal(options.audio, false);
  assert.equal(warnings.length, 0);
  await rtc.stopScreen();
}));
