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
test('somente o host autenticado emite convite seguro de uso único', async () => {
  const created = await post('/api/rooms', createBody({ roomName: 'Convite por link' }));
  assert.equal(created.status, 201);
  const room = await created.json();
  const path = `/api/rooms/${room.code}/invite`;

  const unauthenticated = await post(path, {});
  assert.equal(unauthenticated.status, 403);
  assert.equal((await unauthenticated.json()).error, 'not_host');
  const other = await (await post('/api/rooms', createBody())).json();
  const wrongHost = await fetch(`${base}${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${other.token}` },
  });
  assert.equal(wrongHost.status, 403);

  const issue = () => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${room.token}` },
  });
  const result = await issue();
  assert.equal(result.status, 200);
  assert.match(result.headers.get('cache-control'), /no-store/);
  const invite = await result.json();
  assert.match(invite.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(invite.token, room.token);
  assert.ok(invite.expiresAt > Date.now());
  assert.ok(invite.expiresAt <= Date.now() + 30 * 60 * 1000);

  const renewed = await issue();
  assert.equal(renewed.status, 200);
  const second = await renewed.json();
  assert.notEqual(second.token, invite.token);

  const oldLink = await post(`/api/rooms/${room.code}/join`, {
    name: 'Convidado', inviteToken: invite.token,
  });
  assert.equal(oldLink.status, 401);
  assert.equal((await oldLink.json()).error, 'invalid_invite');

  const invalidToken = await post(`/api/rooms/${room.code}/join`, {
    name: 'Convidado', inviteToken: 'sem-autenticacao',
  });
  assert.equal(invalidToken.status, 401);

  const joined = await post(`/api/rooms/${room.code}/join`, {
    name: 'Convidado', inviteToken: second.token,
  });
  assert.equal(joined.status, 200);
  const guest = await joined.json();
  assert.equal(guest.role, 'guest');
  assert.ok(guest.token.length >= 40);
  assert.equal(guest.name, undefined, 'API mantém o mesmo formato de sessão');

  // O mesmo convite não pode ser usado novamente, mesmo após sair da sala.
  instance.rooms.endGuest(room.code, 'left');
  const replay = await post(`/api/rooms/${room.code}/join`, {
    name: 'Outro convidado', inviteToken: second.token,
  });
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).error, 'invalid_invite');
});

test('trancar e ocupar sala continuam bloqueando entrada por convite', async () => {
  const room = await (await post('/api/rooms', createBody({ roomName: 'Sala protegida' }))).json();
  const path = `/api/rooms/${room.code}/invite`;
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${room.token}` },
  });
  const { token } = await response.json();
  const stored = instance.rooms.getRoom(room.code);
  stored.locked = true;
  let denied = await post(`/api/rooms/${room.code}/join`, {
    name: 'Convidado', inviteToken: token,
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, 'room_locked');
  stored.locked = false;
  const joinedWithPassword = await post(`/api/rooms/${room.code}/join`, {
    name: 'Convidado', password: 'senha-segura',
  });
  assert.equal(joinedWithPassword.status, 200);
  denied = await post(`/api/rooms/${room.code}/join`, {
    name: 'Segundo convidado', inviteToken: token,
  });
  assert.equal(denied.status, 409);
  assert.equal((await denied.json()).error, 'room_full');
});

test('convite expirado e token de sessão guest não dão acesso sem senha', async () => {
  const room = await (await post('/api/rooms', createBody({ roomName: 'Sala expirada' }))).json();
  const path = `/api/rooms/${room.code}/invite`;
  const issue = () => fetch(`${base}${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${room.token}` },
  });
  const { token } = await (await issue()).json();
  instance.rooms.getRoom(room.code).invite.expiresAt = Date.now() - 1;
  const expired = await post(`/api/rooms/${room.code}/join`, {
    name: 'Convidado', inviteToken: token,
  });
  assert.equal(expired.status, 401);
  assert.equal((await expired.json()).error, 'invalid_invite');

  // Sem o fragmento ou a senha, a entrada convencional não muda.
  const passwordRequired = await post(`/api/rooms/${room.code}/join`, { name: 'Convidado' });
  assert.equal(passwordRequired.status, 400);
  const invitedAgain = await (await issue()).json();
  assert.notEqual(invitedAgain.token, token);
  const guest = await (await post(`/api/rooms/${room.code}/join`, {
    name: 'Convidado', inviteToken: invitedAgain.token,
  })).json();
  const guestIssuesInvite = await fetch(`${base}${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${guest.token}` },
  });
  assert.equal(guestIssuesInvite.status, 403);
});

test('tema claro e escuro é entregue à sala e ao início sem código inline', async () => {
  const room = await fetch(`${base}/room.html`);
  assert.equal(room.status, 200);
  const roomHtml = await room.text();
  assert.match(roomHtml, /id="quality-toggle"/);
  assert.match(roomHtml, /id="theme-toggle"/);
  assert.ok(roomHtml.indexOf('id="quality-toggle"') < roomHtml.indexOf('id="theme-toggle"'));
  assert.match(roomHtml, /src="\/js\/theme\.js"/);
  assert.match(roomHtml, /href="\/css\/theme\.css"/);
  assert.match(room.headers.get('content-security-policy'), /script-src 'self'/);

  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  const homeHtml = await home.text();
  assert.match(homeHtml, /src="\/js\/theme\.js"/);
  assert.match(homeHtml, /href="\/css\/theme\.css"/);

  const script = await fetch(`${base}/js/theme.js`);
  assert.equal(script.status, 200);
  assert.match(await script.text(), /wawe:theme/);
  const stylesheet = await fetch(`${base}/css/theme.css`);
  assert.equal(stylesheet.status, 200);
  assert.match(await stylesheet.text(), /data-theme="light"/);
});
