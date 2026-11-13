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

  async join({ code, password, name }) {
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

    const valid = await verifyPassword(password, room.passwordHash);
    if (!valid) {
      throw new RoomError(401, 'bad_password', 'Senha incorreta.');
    }

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