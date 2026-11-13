import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

import { RoomError, RoomManager } from './rooms.js';
import { attachSignaling } from './signaling.js';
import {
  cleanText,
  createRateLimiter,
  getClientIp,
  normalizeCode,
  securityHeaders,
} from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export function createApp({
  publicState = { publicUrl: null, tunnel: 'off' },
  hostGraceMs = 60_000,
  guestGraceMs = 30_000,
  roomTtlMs = 12 * 60 * 60 * 1000,
  trustCloudflare = true,
} = {}) {
  const app = express();
  app.disable('x-powered-by');

  const server = http.createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: 128 * 1024,
    serveClient: true,
    cors: { origin: false },
  });

  const rooms = new RoomManager({ ttlMs: roomTtlMs });
  const clientIp = (request) => getClientIp(request, trustCloudflare);

  app.use(securityHeaders());
  app.use(express.json({ limit: '8kb' }));
  app.use((request, response, next) => {
    response.setHeader(
      'Cache-Control',
      request.path.startsWith('/api/') ? 'no-store' : 'no-cache',
    );
    next();
  });

  const createLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 20,
    keyFn: (request) => `create:${clientIp(request)}`,
  });

  const joinLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 12,
    keyFn: (request) => `join:${clientIp(request)}:${normalizeCode(request.params.code)}`,
  });

  app.get('/api/status', (request, response) => {
    response.json({
      publicUrl: publicState.publicUrl || null,
      tunnel: publicState.tunnel || 'off',
    });
  });

  app.post('/api/rooms', createLimiter, async (request, response, next) => {
    try {
      const roomName = cleanText(request.body?.roomName, 60);
      const hostName = cleanText(request.body?.hostName, 40);
      const password = typeof request.body?.password === 'string'
        ? request.body.password
        : '';

      if (roomName.length < 2) {
        return response.status(400).json({
          error: 'invalid_room_name',
          message: 'O nome da sala precisa ter pelo menos 2 caracteres.',
        });
      }
      if (!hostName) {
        return response.status(400).json({
          error: 'invalid_host_name',
          message: 'Informe o seu nome.',
        });
      }
      if (password.length < 6 || password.length > 128) {
        return response.status(400).json({
          error: 'invalid_password',
          message: 'A senha precisa ter entre 6 e 128 caracteres.',
        });
      }

      const { room, hostToken } = await rooms.create({
        roomName,
        hostName,
        password,
      });

      return response.status(201).json({
        code: room.code,
        roomName: room.name,
        hostName,
        token: hostToken,
        role: 'host',
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/rooms/:code/join', joinLimiter, async (request, response, next) => {
    try {
      const code = normalizeCode(request.params.code);
      const name = cleanText(request.body?.name, 40);
      const password = typeof request.body?.password === 'string'
        ? request.body.password
        : '';

      if (!code) {
        return response.status(400).json({
          error: 'invalid_code',
          message: 'Informe o código da sala.',
        });
      }
      if (!name) {
        return response.status(400).json({
          error: 'invalid_name',
          message: 'Informe o seu nome.',
        });
      }
      if (!password) {
        return response.status(400).json({
          error: 'invalid_password',
          message: 'Informe a senha da sala.',
        });
      }

      const { room, guestToken } = await rooms.join({ code, password, name });

      return response.json({
        code: room.code,
        roomName: room.name,
        hostName: room.host.name,
        token: guestToken,
        role: 'guest',
      });
    } catch (error) {
      if (error instanceof RoomError) {
        return response.status(error.status).json({
          error: error.code,
          message: error.message,
        });
      }
      return next(error);
    }
  });

  app.get('/room', (request, response) => {
    response.sendFile(path.join(PUBLIC_DIR, 'room.html'));
  });

  app.use(express.static(PUBLIC_DIR, {
    index: 'index.html',
    dotfiles: 'deny',
    extensions: false,
    maxAge: 0,
  }));

  // Atalho de convite: /ABC123 em vez de /?room=ABC123
  app.get('/:code', (request, response, next) => {
    const code = normalizeCode(request.params.code);
    if (!/^[A-Z0-9]{6}$/.test(code)) return next();
    return response.redirect(302, `/?room=${encodeURIComponent(code)}`);
  });

  app.use('/api', (request, response) => {
    response.status(404).json({ error: 'not_found', message: 'Rota não encontrada.' });
  });

  app.use((request, response) => {
    response.status(404).type('text/plain').send('Não encontrado.');
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);

    if (error?.type === 'entity.too.large') {
      return response.status(413).json({
        error: 'payload_too_large',
        message: 'Requisição grande demais.',
      });
    }
    if (error instanceof SyntaxError && 'body' in error) {
      return response.status(400).json({
        error: 'invalid_json',
        message: 'JSON inválido.',
      });
    }

    console.error('[wawe] erro interno:', error);
    return response.status(500).json({
      error: 'internal_error',
      message: 'Erro interno.',
    });
  });

  const signaling = attachSignaling(io, {
    rooms,
    hostGraceMs,
    guestGraceMs,
    trustCloudflare,
  });

  async function close() {
    signaling.close();
    createLimiter.close();
    joinLimiter.close();
    await new Promise((resolve) => {
      io.close(() => resolve());
    });
    if (server.listening) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
  }

  return { app, server, io, rooms, publicState, close };
}