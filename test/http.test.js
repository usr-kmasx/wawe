import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { createApp } from '../server/app.js';

let instance;
let base;

before(async () => {
  instance = createApp({
    publicState: {
      publicUrl: 'https://exemplo.trycloudflare.com',
      tunnel: 'up',
    },
    hostGraceMs: 150,
    guestGraceMs: 150,
    roomTtlMs: 60_000,
    trustCloudflare: false,
  });

  await new Promise((resolve) => {
    instance.server.listen(0, '127.0.0.1', resolve);
  });

  base = `http://127.0.0.1:${instance.server.address().port}`;
});

after(async () => {
  await instance.close();
});

function createBody(overrides = {}) {
  return {
    roomName: 'Sala de teste',
    hostName: 'Host',
    password: 'senha-segura',
    ...overrides,
  };
}

async function post(path, body) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('GET /api/status devolve o estado do túnel', async () => {
  const response = await fetch(`${base}/api/status`);
  assert.equal(response.status, 200);

  const data = await response.json();
  assert.equal(data.publicUrl, 'https://exemplo.trycloudflare.com');
  assert.equal(data.tunnel, 'up');
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('página inicial tem headers de segurança e CSP', async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /wawe/);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('aplica validação nos campos da sala', async () => {
  const response = await post('/api/rooms', createBody({ password: '123' }));
  assert.equal(response.status, 400);

  const data = await response.json();
  assert.equal(data.error, 'invalid_password');
});

test('cria a sala, entra como convidado e recusa um segundo convidado', async () => {
  const created = await post('/api/rooms', createBody());
  assert.equal(created.status, 201);

  const room = await created.json();
  assert.match(room.code, /^[A-Z0-9]{6}$/);
  assert.equal(room.role, 'host');
  assert.ok(room.token.length >= 40);

  const wrongPassword = await post(`/api/rooms/${room.code}/join`, {
    name: 'Convidado',
    password: 'senha-errada',
  });
  assert.equal(wrongPassword.status, 401);

  const joined = await post(`/api/rooms/${room.code}/join`, {
    name: 'Convidado',
    password: 'senha-segura',
  });
  assert.equal(joined.status, 200);

  const guest = await joined.json();
  assert.equal(guest.role, 'guest');
  assert.equal(guest.roomName, 'Sala de teste');
  assert.equal(guest.hostName, 'Host');
  assert.ok(guest.token.length >= 40);
  assert.notEqual(guest.token, room.token);

  const secondGuest = await post(`/api/rooms/${room.code}/join`, {
    name: 'Outra pessoa',
    password: 'senha-segura',
  });
  assert.equal(secondGuest.status, 409);

  const secondGuestData = await secondGuest.json();
  assert.equal(secondGuestData.error, 'room_full');
});

test('sala inexistente devolve 404', async () => {
  const response = await post('/api/rooms/ZZZZZZ/join', {
    name: 'Convidado',
    password: 'qualquer-coisa',
  });
  assert.equal(response.status, 404);
});

test('limita tentativas de senha por sala e IP', async () => {
  const created = await post('/api/rooms', createBody({ roomName: 'Sala limitada' }));
  assert.equal(created.status, 201);
  const room = await created.json();

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await post(`/api/rooms/${room.code}/join`, {
      name: 'Convidado',
      password: `errada-${attempt}`,
    });
    assert.equal(response.status, 401);
  }

  const blocked = await post(`/api/rooms/${room.code}/join`, {
    name: 'Convidado',
    password: 'senha-segura',
  });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});

test('não serve arquivos fora de public/', async () => {
  const configResponse = await fetch(`${base}/server/config.js`);
  assert.equal(configResponse.status, 404);

  const packageResponse = await fetch(`${base}/package.json`);
  assert.equal(packageResponse.status, 404);

  const traversal = await fetch(`${base}/..%2fserver%2fconfig.js`);
  assert.equal(traversal.status, 404);
});

test('rota de sala e 404 de API', async () => {
  const roomPage = await fetch(`${base}/room`);
  assert.equal(roomPage.status, 200);
  assert.match(await roomPage.text(), /id="chat-input"/);

  const missing = await fetch(`${base}/api/nao-existe`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'not_found');
});

test('atalho /CODIGO redireciona para o formulário de entrada', async () => {
  const response = await fetch(`${base}/ABC234`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/?room=ABC234');

  const notACode = await fetch(`${base}/abc`, { redirect: 'manual' });
  assert.equal(notACode.status, 404);
});

test('JSON inválido devolve 400', async () => {
  const response = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_json');
});