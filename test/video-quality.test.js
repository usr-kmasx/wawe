import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VIDEO_PROFILES, getProfile, captureConstraints,
  bitrateFor, resolveQuality, setSenderBitrate,
} from '../public/js/video-quality.js';
import { PeerSession } from '../public/js/rtc.js';

test('perfis de qualidade têm limites coerentes e não alteram áudio', () => {
  assert.equal(Object.keys(VIDEO_PROFILES).length, 4);
  assert.deepEqual(captureConstraints('high'), {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 60 },
  });
  assert.ok(bitrateFor('maximum', 'screen') > bitrateFor('balanced', 'screen'));
  assert.equal(getProfile('high').fps, 60);
  assert.equal(getProfile('maximum').fps, 60);
  assert.equal(getProfile('economy').cameraBitrate, 650_000);
  assert.equal(getProfile('economy').screenBitrate, 1_000_000);
  assert.throws(() => getProfile('invalid'), RangeError);
});

test('bitrate atualiza somente encodings existentes do remetente', async () => {
  let saved = null;
  const sender = {
    track: { kind: 'video' },
    getParameters: () => ({ encodings: [{ active: true, maxBitrate: 500000 }] }),
    setParameters: async (parameters) => { saved = parameters; },
  };
  assert.equal(await setSenderBitrate(sender, 6000000), true);
  assert.deepEqual(saved.encodings, [{ active: true, maxBitrate: 6000000 }]);
  assert.equal(await setSenderBitrate({ ...sender, getParameters: () => ({ encodings: [] }) }, 9000000), false);
  assert.equal(await setSenderBitrate(null, 9000000), false);
});

test('câmera e tela aceitam perfis independentes durante a transmissão', async () => {
  const originalStream = Object.getOwnPropertyDescriptor(globalThis, 'MediaStream');
  Object.defineProperty(globalThis, 'MediaStream', {
    configurable: true,
    value: class { constructor(tracks = []) { this.tracks = tracks; } },
  });
  try {
    const cameraConstraints = [];
    const screenConstraints = [];
    const bitrateHistory = { main: [], camera: [] };
    const fakeSender = (name) => ({
      track: { kind: 'video' },
      getParameters: () => ({ encodings: [{ active: true }] }),
      setParameters: async ({ encodings }) => { bitrateHistory[name].push(encodings[0].maxBitrate); },
    });
    const rtc = new PeerSession({ socket: { connected: false } });
    rtc.camTrack = {
      kind: 'video', readyState: 'live',
      applyConstraints: async (constraints) => { cameraConstraints.push(constraints); },
    };
    rtc.screenTrack = {
      kind: 'video', readyState: 'live',
      applyConstraints: async (constraints) => { screenConstraints.push(constraints); },
    };
    rtc.senders.video = fakeSender('main');
    rtc.senders.camera = fakeSender('camera');

    await rtc.setQuality('camera', 'maximum');
    assert.deepEqual(cameraConstraints[0], captureConstraints('maximum'));
    assert.equal(screenConstraints.length, 0);
    assert.equal(bitrateHistory.camera.at(-1), bitrateFor('maximum', 'camera'));
    assert.equal(bitrateHistory.main.at(-1), bitrateFor('high', 'screen'));

    await rtc.setQuality('screen', 'economy');
    assert.deepEqual(screenConstraints[0], captureConstraints('economy'));
    assert.equal(bitrateHistory.main.at(-1), bitrateFor('economy', 'screen'));
    assert.equal(bitrateHistory.camera.at(-1), bitrateFor('maximum', 'camera'));
    await assert.rejects(rtc.setQuality('microphone', 'high'), RangeError);
    assert.equal(rtc.quality.camera, 'maximum');
    assert.equal(rtc.quality.screen, 'economy');
  } finally {
    if (originalStream) Object.defineProperty(globalThis, 'MediaStream', originalStream);
    else delete globalThis.MediaStream;
  }
});

test('resolução e FPS personalizados são independentes dos presets', async () => {
  const highFps = resolveQuality({ height: 720, fps: 60 });
  assert.deepEqual(captureConstraints(highFps), {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 60 },
  });
  assert.equal(bitrateFor(highFps, 'screen') > bitrateFor('balanced', 'screen'), true);
  assert.throws(() => resolveQuality({ height: 1080, fps: 120 }), RangeError);
  assert.throws(() => resolveQuality({ height: 2160, fps: 60 }), RangeError);

  const originalStream = Object.getOwnPropertyDescriptor(globalThis, 'MediaStream');
  Object.defineProperty(globalThis, 'MediaStream', {
    configurable: true,
    value: class { constructor(tracks = []) { this.tracks = tracks; } },
  });
  try {
  const cameraConstraints = [];
  const screenConstraints = [];
  const rtc = new PeerSession({ socket: { connected: false } });
  rtc.camTrack = {
    kind: 'video', readyState: 'live',
    applyConstraints: async (c) => { cameraConstraints.push(c); },
  };
  rtc.screenTrack = {
    kind: 'video', readyState: 'live',
    applyConstraints: async (c) => { screenConstraints.push(c); },
  };

  await rtc.setQuality('camera', 'custom', { height: 720, fps: 60 });
  assert.equal(rtc.quality.camera, 'custom');
  assert.equal(rtc.qualitySettings.camera.fps, 60);
  assert.equal(rtc.quality.screen, 'high');
  assert.equal(rtc.qualitySettings.screen.height, 1080);
  assert.deepEqual(cameraConstraints.at(-1), captureConstraints(highFps));
  assert.equal(screenConstraints.length, 0);

  await rtc.setQuality('screen', 'custom', { height: 480, fps: 30 });
  assert.equal(rtc.qualitySettings.screen.height, 480);
  assert.equal(rtc.qualitySettings.screen.fps, 30);
  assert.equal(cameraConstraints.length, 1);
  assert.equal(screenConstraints.length, 1);

  await rtc.setQuality('screen', 'maximum');
  assert.equal(rtc.quality.screen, 'maximum');
  assert.equal(rtc.qualitySettings.screen.height, 1440);
  assert.equal(rtc.qualitySettings.screen.fps, 60);
  await assert.rejects(rtc.setQuality('camera', 'custom', { height: 1080, fps: 120 }), RangeError);
  assert.equal(rtc.qualitySettings.camera.fps, 60);
  } finally {
    if (originalStream) Object.defineProperty(globalThis, 'MediaStream', originalStream);
    else delete globalThis.MediaStream;
  }
});
