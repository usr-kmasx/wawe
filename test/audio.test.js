import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemotePlayback } from '../public/js/remote-playback.js';
import { PeerSession } from '../public/js/rtc.js';

class FakeStream {
  constructor(tracks = []) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video'); }
}

class FakeMedia {
  constructor() {
    this.srcObject = null;
    this.muted = false;
    this.paused = true;
    this.plays = 0;
  }
  play() {
    this.plays += 1;
    this.paused = false;
    return Promise.resolve();
  }
}

class FakeButton {
  constructor() {
    this.listeners = new Map();
    this.attrs = new Map();
    this.hidden = true;
  }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  removeEventListener(name) { this.listeners.delete(name); }
  setAttribute(name, value) { this.attrs.set(name, value); }
  click() { this.listeners.get('click')?.(); }
}

function withGlobals(run) {
  const originalStream = Object.getOwnPropertyDescriptor(globalThis, 'MediaStream');
  const originalDoc = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const documentListeners = new Map();
  const document = {
    addEventListener(name, fn) { documentListeners.set(name, fn); },
    removeEventListener(name) { documentListeners.delete(name); },
  };
  Object.defineProperty(globalThis, 'MediaStream', { configurable: true, value: FakeStream });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  const restore = () => {
    if (originalStream) Object.defineProperty(globalThis, 'MediaStream', originalStream);
    else delete globalThis.MediaStream;
    if (originalDoc) Object.defineProperty(globalThis, 'document', originalDoc);
    else delete globalThis.document;
  };
  return Promise.resolve().then(() => run({ documentListeners })).finally(restore);
}

test('audio remoto toca sem câmera nem vídeo e o mute afeta apenas a recepção', () => withGlobals(async () => {
  const audio = new FakeMedia();
  const video = new FakeMedia();
  const muteButton = new FakeButton();
  const playback = createRemotePlayback({ audio, video, muteButton });
  const micTrack = { kind: 'audio', enabled: true };

  playback.setPeerPresent(true);
  playback.attach(new FakeStream([micTrack]));
  assert.equal(audio.srcObject.getAudioTracks()[0], micTrack);
  assert.equal(video.srcObject, null);
  assert.equal(video.muted, true);
  assert.equal(audio.plays, 1);
  assert.equal(muteButton.textContent, 'Mutar áudio');

  muteButton.click();
  assert.equal(playback.muted, true);
  assert.equal(audio.muted, true);
  assert.equal(muteButton.textContent, 'Ouvir áudio');
  assert.equal(micTrack.enabled, true);

  muteButton.click();
  assert.equal(playback.muted, false);
  assert.equal(audio.muted, false);
  assert.equal(muteButton.textContent, 'Mutar áudio');

  const screenTrack = { kind: 'video', enabled: true };
  playback.attach(new FakeStream([micTrack, screenTrack]));
  assert.equal(video.srcObject.getVideoTracks()[0], screenTrack);
  assert.equal(audio.srcObject.getAudioTracks()[0], micTrack);
  playback.setPeerPresent(false);
  assert.equal(muteButton.hidden, true);
  assert.equal(audio.srcObject, null);
  playback.destroy();
}));

test('restrição de autoplay recupera o áudio após uma interação comum', () => withGlobals(async ({ documentListeners }) => {
  const audio = new FakeMedia();
  const video = new FakeMedia();
  const muteButton = new FakeButton();
  let calls = 0;
  let blocked = 0;
  audio.play = () => {
    calls += 1;
    if (calls === 1) return Promise.reject(Object.assign(new Error('Autoplay bloqueado'), { name: 'NotAllowedError' }));
    audio.paused = false;
    return Promise.resolve();
  };
  const playback = createRemotePlayback({ audio, video, muteButton, onBlocked: () => { blocked += 1; } });
  playback.setPeerPresent(true);
  playback.attach(new FakeStream([{ kind: 'audio' }]));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(blocked, 1);
  assert.equal(muteButton.textContent, 'Mutar áudio');
  documentListeners.get('pointerdown')();
  assert.equal(calls, 2);
  assert.equal(audio.paused, false);
  playback.destroy();
}));

test('microfone conecta e desconecta somente áudio sem ligar câmera ou tela', () => withGlobals(async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const audioTrack = {
    kind: 'audio',
    enabled: true,
    readyState: 'live',
    addEventListener() {},
    stop() {},
  };
  const requested = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async (settings) => {
      requested.push(settings);
      return new FakeStream([audioTrack]);
    } } },
  });
  try {
    const sentAudio = [];
    const sentVideo = [];
    const emitted = [];
    const rtc = new PeerSession({
      socket: { connected: true, emit: (...args) => emitted.push(args) },
    });
    rtc.senders.audio = { replaceTrack: async (track) => sentAudio.push(track) };
    rtc.senders.video = { replaceTrack: async (track) => sentVideo.push(track) };

    await rtc.toggleMic();
    assert.equal(rtc.mediaState.mic, true);
    assert.equal(rtc.mediaState.cam, false);
    assert.equal(rtc.mediaState.screen, false);
    assert.equal(requested.length, 1);
    assert.equal(requested[0].video, undefined);
    assert.ok(requested[0].audio);
    assert.equal(sentAudio.at(-1), audioTrack);
    assert.equal(sentVideo.at(-1), null);
    assert.equal(emitted.at(-1)[1].mic, true);

    await rtc.toggleMic();
    assert.equal(rtc.mediaState.mic, false);
    assert.equal(sentAudio.at(-1), null);
    assert.equal(audioTrack.enabled, false);
    assert.equal(emitted.at(-1)[1].cam, false);
    rtc.destroy();
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
}));
