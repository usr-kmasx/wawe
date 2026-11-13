function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: positiveNumber(process.env.PORT, 3000),
  tunnel: process.env.TUNNEL !== '0',
  publicUrl: (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '') || null,
  trustCloudflare: process.env.TRUST_CLOUDFLARE !== '0',
  hostGraceMs: positiveNumber(process.env.HOST_GRACE_SEC, 60) * 1000,
  guestGraceMs: positiveNumber(process.env.GUEST_GRACE_SEC, 30) * 1000,
  roomTtlMs: positiveNumber(process.env.ROOM_TTL_MIN, 720) * 60 * 1000,
};