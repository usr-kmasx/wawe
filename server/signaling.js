import crypto from 'node:crypto';
import { cleanMessage, cleanText, getClientIp } from './security.js';

const CHAT_WINDOW_MS = 10_000;
const CHAT_MAX_MESSAGES = 12;

function defaultMedia() {
  return { mic: false, cam: false, screen: false };
}

function readMediaState(socket) {
  const state = socket?.data?.mediaState;
  if (!state) return defaultMedia();
  return { mic: !!state.mic, cam: !!state.cam, screen: !!state.screen };
}

export function attachSignaling(io, {
  rooms,
  hostGraceMs = 60_000,
  guestGraceMs = 30_000,
  trustCloudflare = true,
}) {
  const chatBuckets = new Map();
  const connectionBuckets = new Map();
  const pendingTimers = new Set();

  function schedule(fn, delay) {
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      fn();
    }, delay);
    timer.unref?.();
    pendingTimers.add(timer);
    return timer;
  }

  function allowConnection(ip) {
    const now = Date.now();
    let bucket = connectionBuckets.get(ip);
    if (!bucket || now - bucket.start >= 60_000) {
      bucket = { start: now, count: 0 };
      connectionBuckets.set(ip, bucket);
    }
    bucket.count += 1;

    if (connectionBuckets.size > 5000) {
      for (const [key, value] of connectionBuckets) {
        if (now - value.start >= 60_000) connectionBuckets.delete(key);
      }
    }
    return bucket.count <= 60;
  }

  function allowChat(socketId) {
    const now = Date.now();
    let bucket = chatBuckets.get(socketId);
    if (!bucket || now - bucket.start >= CHAT_WINDOW_MS) {
      bucket = { start: now, count: 0 };
      chatBuckets.set(socketId, bucket);
    }
    bucket.count += 1;
    return bucket.count <= CHAT_MAX_MESSAGES;
  }

  function buildState(room, socket) {
    const participants = [];

    if (room.host.socketId) {
      const hostSocket = io.sockets.sockets.get(room.host.socketId);
      participants.push({
        id: room.host.socketId,
        role: 'host',
        name: room.host.name,
        online: !!hostSocket,
        media: readMediaState(hostSocket),
      });
    }

    if (room.guest?.socketId) {
      const guestSocket = io.sockets.sockets.get(room.guest.socketId);
      participants.push({
        id: room.guest.socketId,
        role: 'guest',
        name: room.guest.name,
        online: !!guestSocket,
        media: readMediaState(guestSocket),
      });
    }

    return {
      self: {
        id: socket.id,
        role: socket.data.session.role,
        name: socket.data.session.name,
      },
      room: {
        code: room.code,
        name: room.name,
        hostName: room.host.name,
        locked: room.locked,
      },
      participants,
    };
  }

  function emitStates(room) {
    const socketIds = io.sockets.adapter.rooms.get(room.code);
    if (!socketIds) return;
    for (const id of socketIds) {
      const socket = io.sockets.sockets.get(id);
      if (socket) socket.emit('room:state', buildState(room, socket));
    }
  }

  function scheduleDisconnects(code) {
    const socketIds = io.sockets.adapter.rooms.get(code);
    if (!socketIds) return;
    for (const id of [...socketIds]) {
      const socket = io.sockets.sockets.get(id);
      if (!socket) continue;
      socket.data.roomEnded = true;
      schedule(() => socket.disconnect(true), 250);
    }
  }

  function announceEnd(room, reason, message, { alreadyEnded = false } = {}) {
    if (!alreadyEnded) rooms.end(room.code, reason);
    io.to(room.code).emit('room:ended', { reason, message });
    scheduleDisconnects(room.code);
  }

  function hostSocketId(room) {
    const id = room?.host?.socketId;
    return id && io.sockets.sockets.get(id) ? id : null;
  }

  function guestSocketId(room) {
    const id = room?.guest?.socketId;
    return id && io.sockets.sockets.get(id) ? id : null;
  }

  io.use((socket, next) => {
    const ip = getClientIp(socket.request, trustCloudflare);
    if (!allowConnection(ip)) return next(new Error('rate_limited'));

    const token = socket.handshake.auth?.token;
    const session = rooms.getSession(token);
    if (!session) return next(new Error('invalid_session'));

    const room = rooms.getRoom(session.roomCode);
    if (!room || room.ended) return next(new Error('invalid_session'));

    if (session.role === 'host' && room.host.token !== session.token) {
      return next(new Error('invalid_session'));
    }
    if (session.role === 'guest' && room.guest?.token !== session.token) {
      return next(new Error('invalid_session'));
    }

    socket.data.session = session;
    socket.data.token = session.token;
    next();
  });

  io.on('connection', (socket) => {
    const session = socket.data.session;
    const isHost = session.role === 'host';
    let room = rooms.getRoom(session.roomCode);

    if (!room) {
      socket.disconnect(true);
      return;
    }

    socket.join(room.code);
    socket.data.mediaState = defaultMedia();

    if (isHost) {
      if (room.host.timer) {
        clearTimeout(room.host.timer);
        room.host.timer = null;
      }
      const previous = room.host.socketId;
      room.host.socketId = socket.id;
      room.host.disconnectedAt = null;
      if (previous && previous !== socket.id) {
        io.sockets.sockets.get(previous)?.disconnect(true);
      }
    } else {
      if (!room.guest || room.guest.token !== session.token) {
        socket.disconnect(true);
        return;
      }
      if (room.guest.timer) {
        clearTimeout(room.guest.timer);
        room.guest.timer = null;
      }
      const previous = room.guest.socketId;
      room.guest.socketId = socket.id;
      if (previous && previous !== socket.id) {
        io.sockets.sockets.get(previous)?.disconnect(true);
      }
    }

    const otherId = isHost ? guestSocketId(room) : hostSocketId(room);
    emitStates(room);

    if (otherId && otherId !== socket.id) {
      const other = io.sockets.sockets.get(otherId);
      other?.emit('peer:joined', {
        peer: {
          id: socket.id,
          role: session.role,
          name: session.name,
          media: readMediaState(socket),
        },
      });
    }

    const currentRoom = () => rooms.getRoom(session.roomCode);

    function relayToPeer(event, payload) {
      const activeRoom = currentRoom();
      if (!activeRoom) return;
      const targetId = isHost ? guestSocketId(activeRoom) : hostSocketId(activeRoom);
      if (!targetId) return;
      socket.to(targetId).emit(event, payload);
    }

    socket.on('rtc:offer', (payload) => {
      const sdp = payload?.sdp;
      if (!sdp || typeof sdp.type !== 'string' || typeof sdp.sdp !== 'string') return;
      if (sdp.sdp.length > 60_000) return;
      relayToPeer('rtc:offer', { sdp });
    });

    socket.on('rtc:answer', (payload) => {
      const sdp = payload?.sdp;
      if (!sdp || typeof sdp.type !== 'string' || typeof sdp.sdp !== 'string') return;
      if (sdp.sdp.length > 60_000) return;
      relayToPeer('rtc:answer', { sdp });
    });

    socket.on('rtc:ice', (payload) => {
      const candidate = payload?.candidate;
      if (!candidate || typeof candidate.candidate !== 'string') return;
      if (candidate.candidate.length > 4000) return;
      relayToPeer('rtc:ice', {
        candidate: {
          candidate: candidate.candidate,
          sdpMid: typeof candidate.sdpMid === 'string' ? candidate.sdpMid : null,
          sdpMLineIndex: Number.isInteger(candidate.sdpMLineIndex)
            ? candidate.sdpMLineIndex
            : null,
          usernameFragment: typeof candidate.usernameFragment === 'string'
            ? candidate.usernameFragment
            : null,
        },
      });
    });

    socket.on('chat:send', (payload) => {
      if (!currentRoom()) return;
      if (!allowChat(socket.id)) {
        socket.emit('chat:error', { message: 'Você está enviando mensagens rápido demais.' });
        return;
      }
      const text = cleanMessage(payload?.text);
      if (!text) return;

      const activeRoom = currentRoom();
      io.to(activeRoom.code).emit('chat:message', {
        id: crypto.randomUUID(),
        from: socket.id,
        name: session.name,
        role: session.role,
        text,
        ts: Date.now(),
      });
    });

    socket.on('media:state', (payload) => {
      socket.data.mediaState = {
        mic: !!payload?.mic,
        cam: !!payload?.cam,
        screen: !!payload?.screen,
        screenAudio: !!payload?.screen && !!payload?.screenAudio,
      };
      relayToPeer('media:state', {
        from: socket.id,
        ...socket.data.mediaState,
      });
    });

    function hostOnly(handler) {
      return (...args) => {
        if (!isHost) return;
        const activeRoom = currentRoom();
        if (!activeRoom) return;
        handler(activeRoom, ...args);
      };
    }

    socket.on('host:lock', hostOnly((activeRoom) => {
      activeRoom.locked = true;
      io.to(activeRoom.code).emit('room:locked', { locked: true });
      emitStates(activeRoom);
    }));

    socket.on('host:unlock', hostOnly((activeRoom) => {
      activeRoom.locked = false;
      io.to(activeRoom.code).emit('room:locked', { locked: false });
      emitStates(activeRoom);
    }));

    socket.on('host:kick', hostOnly((activeRoom) => {
      const guest = rooms.endGuest(activeRoom.code, 'kicked');
      if (!guest) return;

      activeRoom.locked = true;
      const guestSocket = guest.socketId ? io.sockets.sockets.get(guest.socketId) : null;
      if (guestSocket) {
        guestSocket.emit('room:ended', {
          reason: 'removed',
          message: 'Você foi removido da sala pelo host.',
        });
        schedule(() => guestSocket.disconnect(true), 250);
      }

      const hostSocket = hostSocketId(activeRoom);
      if (hostSocket) {
        io.sockets.sockets.get(hostSocket)?.emit('peer:left', {
          role: 'guest',
          name: guest.name,
          reason: 'removed',
        });
      }

      socket.emit('room:locked', { locked: true });
      emitStates(activeRoom);
    }));

    socket.on('host:end', hostOnly((activeRoom) => {
      announceEnd(activeRoom, 'host-ended', 'O host encerrou a sala.');
    }));

    socket.on('room:leave', () => {
      if (isHost) return;
      const activeRoom = currentRoom();
      if (!activeRoom) return;

      const guest = rooms.endGuest(activeRoom.code, 'left');
      if (!guest) return;

      const hostSocket = hostSocketId(activeRoom);
      if (hostSocket) {
        io.sockets.sockets.get(hostSocket)?.emit('peer:left', {
          role: 'guest',
          name: guest.name,
          reason: 'left',
        });
      }
      emitStates(activeRoom);
      schedule(() => socket.disconnect(true), 150);
    });

    socket.on('disconnect', () => {
      chatBuckets.delete(socket.id);
      const activeRoom = currentRoom();
      if (!activeRoom) return;

      if (isHost) {
        if (activeRoom.host.socketId !== socket.id) return;
        activeRoom.host.socketId = null;
        activeRoom.host.disconnectedAt = Date.now();

        const guestSocket = guestSocketId(activeRoom);
        if (guestSocket) {
          io.sockets.sockets.get(guestSocket)?.emit('host:disconnected', {
            graceMs: hostGraceMs,
          });
        }
        emitStates(activeRoom);

        activeRoom.host.timer = schedule(() => {
          const latest = rooms.getRoom(session.roomCode);
          if (latest && !latest.host.socketId) {
            announceEnd(latest, 'host-left', 'O host saiu da sala.');
          }
        }, hostGraceMs);
        return;
      }

      if (activeRoom.guest?.socketId !== socket.id) return;
      activeRoom.guest.socketId = null;

      const hostSocket = hostSocketId(activeRoom);
      if (hostSocket && activeRoom.guest) {
        io.sockets.sockets.get(hostSocket)?.emit('peer:left', {
          role: 'guest',
          name: activeRoom.guest.name,
        });
      }
      emitStates(activeRoom);

      activeRoom.guest.timer = schedule(() => {
        const latest = rooms.getRoom(session.roomCode);
        if (latest?.guest && !latest.guest.socketId) {
          const guest = rooms.endGuest(latest.code, 'timeout');
          const latestHost = hostSocketId(latest);
          if (latestHost) {
            io.sockets.sockets.get(latestHost)?.emit('peer:left', {
              role: 'guest',
              name: guest?.name || 'Convidado',
            });
          }
          emitStates(latest);
        }
      }, guestGraceMs);
    });
  });

  const sweeper = setInterval(() => {
    for (const room of rooms.expireOld()) {
      io.to(room.code).emit('room:ended', {
        reason: 'expired',
        message: 'A sala expirou por inatividade.',
      });
      scheduleDisconnects(room.code);
    }
  }, 60_000);
  sweeper.unref?.();

  function close() {
    clearInterval(sweeper);
    for (const timer of pendingTimers) clearTimeout(timer);
    pendingTimers.clear();
    for (const room of rooms.rooms.values()) {
      if (room.host.timer) clearTimeout(room.host.timer);
      if (room.guest?.timer) clearTimeout(room.guest.timer);
    }
  }

  return { close };
}