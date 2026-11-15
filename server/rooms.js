import crypto from 'node:crypto';

import {
  hashPassword,
  randomCode,
  randomToken,
  verifyPassword,
} from './security.js';

export class RoomError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'RoomError';
    this.status = status;
    this.code = code;
  }
}

const INVITE_TTL_MS = 30 * 60 * 1000;

export class RoomManager {
  constructor({ ttlMs = 12 * 60 * 60 * 1000 } = {}) {
    this.rooms = new Map();
    this.sessions = new Map();
    this.ttlMs = ttlMs;
  }

  async create({ roomName, hostName, password }) {
    const code = this.#newCode();
    const passwordHash = await hashPassword(password);
    const hostToken = randomToken();
    const now = Date.now();

    const room = {
      code,
      name: roomName,
      passwordHash,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      locked: false,
      ended: false,
      host: {
        token: hostToken,
        name: hostName,
        socketId: null,
        disconnectedAt: null,
        timer: null,
      },
      guest: null,
      invite: null,
    };

    this.rooms.set(code, room);
    this.sessions.set(hostToken, {
      token: hostToken,
      roomCode: code,
      role: 'host',
      name: hostName,
      createdAt: now,
    });

    return { room, hostToken };
  }

  // Um convite equivale a uma autorização temporária para entrar sem senha.
  // Só uma sessão host legítima pode emiti-lo. Novo clique invalida o anterior.
  createInvite({ code, hostToken }) {
    const room = this.rooms.get(code);
    const session = this.getSession(hostToken);
    if (!room || room.ended || Date.now() >= room.expiresAt) {
      throw new RoomError(404, 'room_not_found', 'Sala não encontrada ou expirada.');
    }
    if (!session || session.role !== 'host'
      || session.roomCode !== code || room.host.token !== hostToken) {
      throw new RoomError(403, 'not_host', 'Somente o host pode gerar convites.');
    }

    const token = randomToken();
    const expiresAt = Math.min(room.expiresAt, Date.now() + INVITE_TTL_MS);
    room.invite = {
      digest: crypto.createHash('sha256').update(token).digest(),
      expiresAt,
    };
    return { token, expiresAt };
  }

  async join({ code, password, name, inviteToken }) {
    const room = this.rooms.get(code);
    if (!room || room.ended) {
      throw new RoomError(404, 'room_not_found', 'Sala não encontrada ou expirada.');
    }
    if (room.locked) {
      throw new RoomError(403, 'room_locked', 'A sala está bloqueada pelo host.');
    }
    if (room.guest) {
      throw new RoomError(409, 'room_full', 'Esta sala já tem um convidado.');
    }

    const usingInvite = inviteToken !== undefined && inviteToken !== null;
    if (usingInvite) {
      const invite = room.invite;
      const candidate = typeof inviteToken === 'string'
        && /^[A-Za-z0-9_-]{43}$/.test(inviteToken)
        ? crypto.createHash('sha256').update(inviteToken).digest()
        : null;
      if (!candidate || !invite || Date.now() >= invite.expiresAt
        || !crypto.timingSafeEqual(candidate, invite.digest)) {
        throw new RoomError(401, 'invalid_invite', 'Convite inválido ou expirado. Peça um novo link ao host.');
      }
    } else {
      const valid = await verifyPassword(password, room.passwordHash);
      if (!valid) {
        throw new RoomError(401, 'bad_password', 'Senha incorreta.');
      }
    }
    // A verificação de senha é assíncrona: um segundo participante pode ter
    // entrado ou o host pode ter trancado a sala enquanto ela era calculada.
    if (room.guest) throw new RoomError(409, 'room_full', 'Esta sala já tem um convidado.');
    if (room.locked) throw new RoomError(403, 'room_locked', 'A sala está bloqueada pelo host.');
    if (room.ended || !this.rooms.has(code) || Date.now() >= room.expiresAt) {
      throw new RoomError(404, 'room_not_found', 'Sala não encontrada ou expirada.');
    }
    if (usingInvite) room.invite = null; // credencial de uso único

    const guestToken = randomToken();
    const now = Date.now();
    room.guest = {
      token: guestToken,
      name,
      socketId: null,
      joinedAt: now,
      timer: null,
    };
    this.sessions.set(guestToken, {
      token: guestToken,
      roomCode: code,
      role: 'guest',
      name,
      createdAt: now,
    });

    return { room, guestToken };
  }

  getRoom(code) {
    return this.rooms.get(code) || null;
  }

  getSession(token) {
    if (typeof token !== 'string' || token.length < 20) return null;
    return this.sessions.get(token) || null;
  }

  end(code, reason) {
    const room = this.rooms.get(code);
    if (!room) return null;

    room.ended = true;
    room.endReason = reason;
    this.rooms.delete(code);
    this.sessions.delete(room.host.token);
    if (room.guest) this.sessions.delete(room.guest.token);
    if (room.host.timer) clearTimeout(room.host.timer);
    if (room.guest?.timer) clearTimeout(room.guest.timer);
    return room;
  }

  endGuest(code, reason) {
    const room = this.rooms.get(code);
    if (!room || !room.guest) return null;

    const guest = room.guest;
    this.sessions.delete(guest.token);
    if (guest.timer) clearTimeout(guest.timer);
    room.guest = null;
    room.lastGuestEnd = reason;
    return guest;
  }

  expireOld(now = Date.now()) {
    const expired = [];
    for (const room of this.rooms.values()) {
      if (now >= room.expiresAt) expired.push(room);
    }
    for (const room of expired) {
      room.ended = true;
      room.endReason = 'expired';
      this.rooms.delete(room.code);
      this.sessions.delete(room.host.token);
      if (room.guest) this.sessions.delete(room.guest.token);
      if (room.host.timer) clearTimeout(room.host.timer);
      if (room.guest?.timer) clearTimeout(room.guest.timer);
    }
    return expired;
  }

  #newCode() {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const code = randomCode(6);
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Não foi possível gerar um código de sala.');
  }
}