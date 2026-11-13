const $ = (selector) => document.querySelector(selector);

const createForm = $('#create-form');
const joinForm = $('#join-form');
const createError = $('#create-error');
const joinError = $('#join-error');

const params = new URLSearchParams(location.search);
const prefillCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function showError(element, message) {
  element.textContent = message || '';
  element.hidden = !message;
}

function setBusy(form, busy) {
  for (const element of form.elements) {
    if (element.tagName === 'BUTTON' || element.tagName === 'INPUT') {
      element.disabled = busy;
    }
  }
}

function saveSession(code, data) {
  try {
    sessionStorage.setItem(`wawe:session:${code}`, JSON.stringify(data));
  } catch {
    // sessão em memória não é possível; a navegação seguinte pedirá a senha novamente
  }
}

function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

if (prefillCode) {
  joinForm.elements.code.value = prefillCode;
  joinForm.classList.add('prefilled');
  setTimeout(() => joinForm.elements.name.focus(), 120);
}

for (const button of document.querySelectorAll('.pw-toggle')) {
  button.addEventListener('click', () => {
    const input = button.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? 'ocultar' : 'ver';
    button.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  });
}

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError(createError, '');

  const roomName = createForm.elements.roomName.value.trim();
  const hostName = createForm.elements.hostName.value.trim();
  const password = createForm.elements.password.value;

  if (roomName.length < 2) {
    showError(createError, 'O nome da sala precisa ter pelo menos 2 caracteres.');
    return;
  }
  if (!hostName) {
    showError(createError, 'Informe o seu nome.');
    return;
  }
  if (password.length < 6) {
    showError(createError, 'A senha precisa ter pelo menos 6 caracteres.');
    return;
  }

  setBusy(createForm, true);
  try {
    const { response, payload } = await postJson('/api/rooms', {
      roomName,
      hostName,
      password,
    });

    if (!response.ok) {
      showError(createError, payload.message || 'Não foi possível criar a sala.');
      return;
    }

    saveSession(payload.code, {
      token: payload.token,
      role: payload.role,
      name: payload.hostName,
      roomName: payload.roomName,
    });
    location.href = `/room.html?room=${encodeURIComponent(payload.code)}`;
  } catch {
    showError(createError, 'Falha de conexão. O script do servidor está rodando?');
  } finally {
    setBusy(createForm, false);
  }
});

joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError(joinError, '');

  const code = normalizeCode(joinForm.elements.code.value);
  const name = joinForm.elements.name.value.trim();
  const password = joinForm.elements.password.value;

  if (!code) {
    showError(joinError, 'Informe o código da sala.');
    return;
  }
  if (!name) {
    showError(joinError, 'Informe o seu nome.');
    return;
  }
  if (!password) {
    showError(joinError, 'Informe a senha da sala.');
    return;
  }

  setBusy(joinForm, true);
  try {
    const { response, payload } = await postJson(
      `/api/rooms/${encodeURIComponent(code)}/join`,
      { name, password },
    );

    if (!response.ok) {
      showError(joinError, payload.message || 'Não foi possível entrar na sala.');
      if (payload.error === 'room_not_found') joinForm.elements.code.focus();
      if (payload.error === 'bad_password') joinForm.elements.password.select();
      return;
    }

    saveSession(payload.code, {
      token: payload.token,
      role: payload.role,
      name,
      roomName: payload.roomName,
    });
    location.href = `/room.html?room=${encodeURIComponent(payload.code)}`;
  } catch {
    showError(joinError, 'Falha de conexão. O script do servidor está rodando?');
  } finally {
    setBusy(joinForm, false);
  }
});

joinForm.elements.code.addEventListener('input', () => {
  const input = joinForm.elements.code;
  const position = input.selectionStart ?? input.value.length;
  const normalized = normalizeCode(input.value);
  input.value = normalized;
  const safePosition = Math.min(position, normalized.length);
  try {
    input.setSelectionRange(safePosition, safePosition);
  } catch {
    // alguns navegadores móveis não expõem seleção
  }
});
