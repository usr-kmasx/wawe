// Configurações da mídia enviada. WebRTC e o navegador podem limitar os
// valores pedidos conforme codificador, dispositivo e rede disponíveis.
export const VIDEO_RESOLUTIONS = Object.freeze({
  480: Object.freeze({ width: 854, height: 480 }),
  720: Object.freeze({ width: 1280, height: 720 }),
  1080: Object.freeze({ width: 1920, height: 1080 }),
  1440: Object.freeze({ width: 2560, height: 1440 }),
});
export const VIDEO_FPS = Object.freeze([15, 30, 60]);

const CAMERA_BASE_BITRATE = Object.freeze({
  480: 850_000, 720: 1_800_000, 1080: 3_500_000, 1440: 6_000_000,
});
const SCREEN_BASE_BITRATE = Object.freeze({
  480: 1_300_000, 720: 3_000_000, 1080: 6_000_000, 1440: 10_000_000,
});

export function resolveQuality({ height, fps }) {
  const resolution = VIDEO_RESOLUTIONS[height];
  if (!resolution || !VIDEO_FPS.includes(fps)) {
    throw new RangeError('Resolução ou FPS não suportados.');
  }
  const multiplier = fps === 15 ? 0.75 : fps === 60 ? 1.6 : 1;
  const bitrate = (base) => Math.round(base * multiplier / 50_000) * 50_000;
  return Object.freeze({
    ...resolution, fps,
    cameraBitrate: bitrate(CAMERA_BASE_BITRATE[height]),
    screenBitrate: bitrate(SCREEN_BASE_BITRATE[height]),
  });
}

export const VIDEO_PROFILES = Object.freeze({
  economy: Object.freeze({ label: 'Econômica · 480p / 15 FPS', ...resolveQuality({ height: 480, fps: 15 }) }),
  balanced: Object.freeze({ label: 'Equilibrada · 720p / 30 FPS', ...resolveQuality({ height: 720, fps: 30 }) }),
  high: Object.freeze({ label: 'Alta · 1080p / 60 FPS', ...resolveQuality({ height: 1080, fps: 60 }) }),
  maximum: Object.freeze({ label: 'Máxima · 1440p / 60 FPS', ...resolveQuality({ height: 1440, fps: 60 }) }),
});

export function getProfile(id) {
  if (!Object.hasOwn(VIDEO_PROFILES, id)) {
    throw new RangeError('Perfil de qualidade desconhecido.');
  }
  return VIDEO_PROFILES[id];
}

function settings(input) {
  if (typeof input === 'string') return getProfile(input);
  return resolveQuality(input);
}

export function captureConstraints(input) {
  const quality = settings(input);
  return {
    width: { ideal: quality.width },
    height: { ideal: quality.height },
    frameRate: { ideal: quality.fps },
  };
}

export function bitrateFor(input, kind) {
  const quality = settings(input);
  return kind === 'screen' ? quality.screenBitrate : quality.cameraBitrate;
}

// Modifica apenas as codificações existentes, sem afetar SDP, codecs ou áudio.
export async function setSenderBitrate(sender, bitrate) {
  if (!sender?.track || typeof sender.getParameters !== 'function'
    || typeof sender.setParameters !== 'function') return false;
  const parameters = sender.getParameters();
  if (!Array.isArray(parameters.encodings) || parameters.encodings.length === 0) return false;
  if (parameters.encodings.every((encoding) => encoding.maxBitrate === bitrate)) return true;
  parameters.encodings.forEach((encoding) => { encoding.maxBitrate = bitrate; });
  await sender.setParameters(parameters);
  return true;
}
