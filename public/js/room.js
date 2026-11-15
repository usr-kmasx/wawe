import { PeerSession } from './rtc.js';
import { createVideoStage } from './stage-layout.js';
import { createVideoPiP } from './video-pip.js';
import { createRemotePlayback } from './remote-playback.js';
import { getProfile, resolveQuality, VIDEO_PROFILES } from './video-quality.js';

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const code = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const storageKey = `wawe:session:${code}`;

const elements = {
  roomName: $('room-name'),
  roomCode: $('room-code'),
  roleBadge: $('role-badge'),
  connStatus: $('conn-status'),
  connLabel: document.querySelector('#conn-status .status-label'),
  copyLink: $('copy-link'),
  qualityWrap: $('quality-menu-wrap'),
  qualityToggle: $('quality-toggle'),
  qualityPanel: $('quality-panel'),
  cameraQuality: $('camera-quality'),
  cameraResolution: $('camera-resolution'),
  cameraFps: $('camera-fps'),
  screenQuality: $('screen-quality'),
  screenResolution: $('screen-resolution'),
  screenFps: $('screen-fps'),
  qualityStatus: $('quality-status'),
  leave: $('leave'),

  remoteVideo: $('remote-video'),
  remoteAudio: $('remote-audio'),
  remoteMute: $('remote-mute'),
  remoteCameraVideo: $('remote-camera-video'),
  remotePlaceholder: $('remote-placeholder'),
  remoteInitial: $('remote-initial'),
  remoteLabel: $('remote-label'),
  remoteChips: $('remote-chips'),
  remoteTile: $('remote-tile'),
  videos: document.querySelector('.videos'),

  localVideo: $('local-video'),
  localCameraVideo: $('local-camera-video'),
  localInitial: $('local-initial'),
  localLabel: $('local-label'),
  localChips: $('local-chips'),

  overlay: $('overlay'),
  overlayTitle: $('overlay-title'),
  overlayText: $('overlay-text'),
  overlayAction: $('overlay-action'),

  mic: $('mic'),
  micLabel: $('mic-label'),
  cam: $('cam'),
  camLabel: $('cam-label'),
  share: $('share'),
  shareLabel: $('share-label'),
  hostTools: $('host-tools'),
  lock: $('lock'),
  kick: $('kick'),
  end: $('end'),

  messages: $('messages'),
  chatForm: $('chat-form'),
  chatInput: $('chat-input'),
  chatSend: $('chat-send'),

  toast: $('toast'),
};

function readSession() {
  try {
    const raw = sessionStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const storedSession = readSession();

if (!storedSession?.token) {
  const query = code ? `?room=${encodeURIComponent(code)}` : '';
  location.replace(`/${query}`);
} else {
  start(storedSession);
}

function start(session) {
  const state = {
    role: session.role === 'guest' ? 'guest' : 'host',
    selfId: null,
    peer: null,
    locked: false,
    hostAway: false,
    ended: false,
    toastTimer: null,
  };

  const socket = io({
    auth: { token: session.token },
    reconnection: true,
    reconnectionDelayMax: 4000,
  });

  const rtc = new PeerSession({
    socket,
    callbacks: {
      onRemoteStream(stream) {
        remotePlayback.attach(stream);
        videoPiP.sync();
      },
      onRemoteCameraStream(stream) {
        elements.remoteCameraVideo.srcObject = stream || null;
        updateRemoteCameraPreview();
        if (stream) elements.remoteCameraVideo.play().catch(() => {});
        videoPiP.sync();
      },
      onLocalCameraStream(stream) {
        elements.localCameraVideo.srcObject = stream || null;
        if (stream) elements.localCameraVideo.play().catch(() => {});
        updateSoloPreview();
        videoPiP.sync();
      },
      onLocalStream(stream) {
        elements.localVideo.srcObject = stream || null;
        const hasVideo = Boolean(stream?.getVideoTracks().length);
        elements.localVideo.classList.toggle('hidden-media', !hasVideo);
        updateSoloPreview();
        videoPiP.sync();
      },
      onMediaChange(media) {
        syncMediaUi(media);
      },
      onConnection(connectionState) {
        const labels = {
          new: 'conectando',
          connecting: 'conectando',
          connected: 'conectado',
          disconnected: 'reconectando',
          failed: 'falha na conexão',
          closed: 'conexão encerrada',
        };
        const visual = connectionState === 'connected'
          ? 'ok'
          : connectionState === 'failed'
            ? 'err'
            : 'warn';
        setConnection(visual, labels[connectionState] || connectionState);
        if (connectionState === 'failed') {
          toast('A conexão caiu. Tentando restabelecer…');
        }
      },
      onError(message) {
        toast(message);
      },
    },
  });

  const remotePlayback = createRemotePlayback({
    audio: elements.remoteAudio,
    video: elements.remoteVideo,
    muteButton: elements.remoteMute,
    onBlocked: () => toast('O navegador bloqueou o áudio automático. Interaja com a página para liberar a reprodução.'),
  });

  const videoPiP = createVideoPiP({
    sources: {
      'remote-main': elements.remoteVideo,
      'local-main': elements.localVideo,
      'remote-camera': elements.remoteCameraVideo,
      'local-camera': elements.localCameraVideo,
    },
    isActive(key) {
      const local = rtc.mediaState;
      const remote = state.peer?.media;
      if (key === 'remote-main') return Boolean(remote?.cam || remote?.screen);
      if (key === 'local-main') return Boolean(local.cam || local.screen);
      if (key === 'remote-camera') return Boolean(remote?.cam && remote?.screen);
      if (key === 'local-camera') return Boolean(local.cam && local.screen);
      return false;
    },
    onError: toast,
  });

  const videoLayout = createVideoStage({
    onPictureInPicture: videoPiP.supported ? (key) => videoPiP.toggle(key) : null,
    container: elements.videos,
    overlay: elements.overlay,
    tiles: {
      'remote-main': { tile: elements.remoteTile, video: elements.remoteVideo, label: elements.remoteLabel },
      'local-main': { tile: $('local-tile'), video: elements.localVideo, label: elements.localLabel },
      'remote-camera': { video: elements.remoteCameraVideo },
      'local-camera': { video: elements.localCameraVideo },
    },
  });

  setupQualityControls();

  let publicUrl = null;
  let statusAttempts = 0;
  let statusTimer = null;

  elements.roomName.textContent = session.roomName || 'Sala';
  elements.roomCode.textContent = code || '······';
  elements.roleBadge.textContent = state.role === 'host' ? 'host' : 'convidado';
  elements.roleBadge.dataset.role = state.role;
  elements.localInitial.textContent = initialOf(session.name);
  elements.localLabel.textContent = `${session.name} (você)`;
  elements.hostTools.hidden = state.role !== 'host';
  elements.copyLink.hidden = state.role !== 'host';
  elements.chatSend.disabled = false;
  document.title = `${session.roomName || 'Sala'} · wawe`;

  showWaiting();
  loadStatus();

  socket.on('connect', () => {
    state.selfId = socket.id;
    setConnection('ok', 'conectado');
    rtc.emitState();
  });

  socket.on('disconnect', () => {
    if (state.ended) return;
    setConnection('warn', 'reconectando');
  });

  socket.on('connect_error', (error) => {
    if (state.ended) return;

    if (error.message === 'invalid_session') {
      endSession(
        'A sala não está mais disponível',
        'Ela foi encerrada ou você não faz mais parte dela.',
      );
      return;
    }

    if (error.message === 'rate_limited') {
      endSession(
        'Muitas tentativas',
        'Aguarde um minuto e recarregue a página.',
      );
      return;
    }

    setConnection('warn', 'reconectando');
  });

  socket.on('room:state', ({ self, room, participants }) => {
    if (state.ended) return;

    state.selfId = self.id;
    state.role = self.role === 'guest' ? 'guest' : 'host';
    state.locked = Boolean(room.locked);

    elements.roomName.textContent = room.name;
    elements.roomCode.textContent = room.code;
    elements.roleBadge.textContent = state.role === 'host' ? 'host' : 'convidado';
    elements.roleBadge.dataset.role = state.role;
    elements.hostTools.hidden = state.role !== 'host';
    elements.copyLink.hidden = state.role !== 'host';

    const peer = participants.find((participant) => participant.id !== self.id) || null;
    state.peer = peer;
    remotePlayback.setPeerPresent(Boolean(peer));

    if (peer) {
      state.hostAway = false;
      updateRemotePeer(peer);
      hideOverlay();
    } else {
      updateRemotePeer(null);
      if (state.role === 'guest' && state.hostAway) {
        showOverlay(
          'Host reconectando…',
          'A sala será encerrada se o host não voltar.',
        );
      } else {
        showWaiting();
      }
    }

    updateSoloPreview();
    updateHostTools();
  });

  socket.on('peer:joined', ({ peer }) => {
    if (state.ended) return;
    state.peer = peer;
    remotePlayback.setPeerPresent(true);
    state.hostAway = false;
    updateRemotePeer(peer);
    hideOverlay();
    updateSoloPreview();
    updateHostTools();
    rtc.emitState();
    rtc.startOffer().catch(() => {
      toast('Não foi possível iniciar a conexão de mídia.');
    });
  });

  socket.on('peer:left', ({ name, reason }) => {
    if (state.ended) return;
    rtc.closePeer();
    state.peer = null;
    remotePlayback.setPeerPresent(false);
    updateRemotePeer(null);
    showWaiting();
    updateSoloPreview();
    updateHostTools();
    if (reason === 'removed' || !name) return;
    toast(`${name} saiu da sala.`);
  });

  socket.on('host:disconnected', ({ graceMs }) => {
    if (state.ended || state.role !== 'guest') return;
    state.hostAway = true;
    rtc.closePeer();
    state.peer = null;
    remotePlayback.setPeerPresent(false);
    updateRemotePeer(null);
    updateHostTools();
    const seconds = Math.max(1, Math.round((graceMs || 0) / 1000));
    showOverlay(
      'Host reconectando…',
      `A sala será encerrada se ele não voltar em ${seconds}s.`,
    );
  });

  socket.on('room:locked', ({ locked }) => {
    state.locked = Boolean(locked);
    updateHostTools();
    toast(locked ? 'Sala trancada: novas entradas bloqueadas.' : 'Sala destrancada.');
  });

  socket.on('room:ended', ({ reason, message }) => {
    if (state.ended) return;
    const titles = {
      'host-ended': 'O host encerrou a sala',
      'host-left': 'O host saiu da sala',
      removed: 'Você foi removido da sala',
      expired: 'A sala expirou',
    };
    endSession(titles[reason] || 'Sala encerrada', message || 'A sala não está mais disponível.');
  });

  socket.on('chat:message', (message) => {
    appendMessage(message);
  });

  socket.on('chat:error', ({ message }) => {
    toast(message || 'Não foi possível enviar a mensagem.');
  });

  socket.on('media:state', (payload) => {
    if (!state.peer || payload.from !== state.peer.id) return;
    state.peer.media = {
      mic: Boolean(payload.mic),
      cam: Boolean(payload.cam),
      screen: Boolean(payload.screen),
      screenAudio: Boolean(payload.screenAudio),
    };
    renderChips(elements.remoteChips, state.peer.media);
    elements.remoteLabel.textContent = labelForPeer(state.peer);
    elements.remoteVideo.classList.toggle(
      'hidden-media',
      !(state.peer.media.cam || state.peer.media.screen),
    );
    elements.remoteVideo.classList.toggle('screen', Boolean(state.peer.media.screen));
    elements.remoteInitial.textContent = initialOf(state.peer.name);
    if (state.peer.media.mic) remotePlayback.playAudio();
    updateRemoteCameraPreview();
  });

  socket.on('rtc:offer', ({ sdp }) => {
    if (state.ended) return;
    hideOverlay();
    rtc.handleOffer(sdp).catch(() => {
      toast('Falha ao montar a conexão de mídia.');
    });
  });

  socket.on('rtc:answer', ({ sdp }) => {
    rtc.handleAnswer(sdp).catch(() => {
      toast('Falha ao completar a conexão de mídia.');
    });
  });

  socket.on('rtc:ice', ({ candidate }) => {
    rtc.handleIce(candidate).catch(() => {});
  });

  elements.mic.addEventListener('click', async () => {
    try {
      await rtc.toggleMic();
    } catch (error) {
      toast(error.message);
    }
  });

  elements.cam.addEventListener('click', async () => {
    try {
      await rtc.toggleCam();
    } catch (error) {
      toast(error.message);
    }
  });

  elements.share.addEventListener('click', async () => {
    try {
      if (rtc.mediaState.screen) await rtc.stopScreen();
      else await rtc.startScreen();
    } catch (error) {
      toast(error.message);
    }
  });

  elements.copyLink.addEventListener('click', copyInvite);

  elements.lock.addEventListener('click', () => {
    socket.emit(state.locked ? 'host:unlock' : 'host:lock');
  });

  elements.kick.addEventListener('click', () => {
    if (!state.peer) return;
    if (!confirm('Remover o convidado? A sala ficará trancada.')) return;
    socket.emit('host:kick');
  });

  elements.end.addEventListener('click', () => {
    if (!confirm('Encerrar a sala para todos?')) return;
    socket.emit('host:end');
    setTimeout(() => {
      endSession('Você encerrou a sala', 'A sala foi fechada para todos.');
    }, 150);
  });

  elements.leave.addEventListener('click', () => {
    if (state.role === 'host') {
      if (!confirm('Sair agora encerra a sala para todos. Continuar?')) return;
      socket.emit('host:end');
      setTimeout(() => {
        endSession('Você encerrou a sala', 'A sala foi fechada para todos.');
      }, 150);
      return;
    }

    socket.emit('room:leave');
    videoPiP.destroy();
    rtc.destroy();
    setConnection('off', 'saindo…');
    setTimeout(() => location.replace('/'), 150);
  });

  elements.chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.ended) return;
    const text = elements.chatInput.value.trim();
    if (!text) return;
    socket.emit('chat:send', { text });
    elements.chatInput.value = '';
    autoGrowInput();
    elements.chatInput.focus();
  });

  elements.chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      elements.chatForm.requestSubmit();
    }
  });

  elements.chatInput.addEventListener('input', autoGrowInput);

  window.addEventListener('pagehide', () => {
    videoPiP.destroy();
    rtc.destroy();
    socket.disconnect();
  });

  function setupQualityControls() {
    const kinds = {
      camera: {
        preset: elements.cameraQuality,
        resolution: elements.cameraResolution,
        fps: elements.cameraFps,
      },
      screen: {
        preset: elements.screenQuality,
        resolution: elements.screenResolution,
        fps: elements.screenFps,
      },
    };

    // Lê também as preferências antigas, que guardavam apenas o ID do preset.
    try {
      const saved = JSON.parse(localStorage.getItem('wawe:video-quality') || '{}');
      for (const kind of ['camera', 'screen']) {
        try {
          const entry = saved[kind];
          if (typeof entry === 'string' && Object.hasOwn(VIDEO_PROFILES, entry)) {
            rtc.quality[kind] = entry;
            rtc.qualitySettings[kind] = getProfile(entry);
          } else if (entry && typeof entry === 'object') {
            if (entry.preset === 'custom') {
              rtc.quality[kind] = 'custom';
              rtc.qualitySettings[kind] = resolveQuality({
                height: Number(entry.height),
                fps: Number(entry.fps),
              });
            } else if (Object.hasOwn(VIDEO_PROFILES, entry.preset)) {
              rtc.quality[kind] = entry.preset;
              rtc.qualitySettings[kind] = getProfile(entry.preset);
            }
          }
        } catch {
          // Um valor inválido não afeta a configuração da outra mídia.
        }
      }
    } catch {
      // Armazenamento indisponível: mantêm-se os presets padrão.
    }

    const syncControls = (kind) => {
      const controls = kinds[kind];
      const quality = rtc.qualitySettings[kind];
      controls.preset.value = rtc.quality[kind];
      controls.resolution.value = String(quality.height);
      controls.fps.value = String(quality.fps);
    };

    const saveSettings = () => {
      try {
        localStorage.setItem('wawe:video-quality', JSON.stringify(
          Object.fromEntries(['camera', 'screen'].map((kind) => [kind, {
            preset: rtc.quality[kind],
            height: rtc.qualitySettings[kind].height,
            fps: rtc.qualitySettings[kind].fps,
          }])),
        ));
      } catch {
        // Preferência não será lembrada em navegadores sem armazenamento.
      }
    };

    for (const kind of ['camera', 'screen']) {
      syncControls(kind);
      const controls = kinds[kind];
      const inputs = Object.values(controls);

      async function apply(preset) {
        inputs.forEach((input) => { input.disabled = true; });
        elements.qualityStatus.textContent = 'Aplicando qualidade…';
        try {
          const custom = {
            height: Number(controls.resolution.value),
            fps: Number(controls.fps.value),
          };
          await rtc.setQuality(kind, preset, custom);
          syncControls(kind);
          saveSettings();
          elements.qualityStatus.textContent =
            'Perfil solicitado. Resolução e FPS efetivos dependem da captura, codificador e rede.';
        } catch {
          syncControls(kind);
          elements.qualityStatus.textContent =
            'Não foi possível aplicar estes valores neste dispositivo.';
        } finally {
          inputs.forEach((input) => { input.disabled = false; });
        }
      }

      controls.preset.addEventListener('change', () => apply(controls.preset.value));
      controls.resolution.addEventListener('change', () => apply('custom'));
      controls.fps.addEventListener('change', () => apply('custom'));
    }

    const closeMenu = () => {
      elements.qualityPanel.hidden = true;
      elements.qualityToggle.setAttribute('aria-expanded', 'false');
    };
    elements.qualityToggle.addEventListener('click', () => {
      const open = elements.qualityPanel.hidden;
      elements.qualityPanel.hidden = !open;
      elements.qualityToggle.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('pointerdown', (event) => {
      if (!elements.qualityWrap.contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !elements.qualityPanel.hidden) {
        closeMenu();
        elements.qualityToggle.focus();
      }
    });
  }

  function setConnection(visual, label) {
    elements.connStatus.dataset.state = visual;
    elements.connLabel.textContent = label;
  }

  function showOverlay(title, text, actionLabel, action) {
    elements.overlayTitle.textContent = title;
    elements.overlayText.textContent = text || '';
    if (actionLabel && action) {
      elements.overlayAction.hidden = false;
      elements.overlayAction.textContent = actionLabel;
      elements.overlayAction.onclick = action;
    } else {
      elements.overlayAction.hidden = true;
      elements.overlayAction.onclick = null;
    }
    elements.overlay.hidden = false;
  }

  function hideOverlay() {
    elements.overlay.hidden = true;
  }

  function updateSoloPreview() {
    if (state.ended) return;
    const local = rtc.mediaState;
    const remote = state.peer?.media;
    videoLayout.refresh({
      'remote-main': {
        active: Boolean(state.peer),
        screen: Boolean(remote?.screen),
        label: remote?.screen ? `${state.peer.name} · tela` : state.peer?.name || 'Convidado',
      },
      'remote-camera': {
        active: Boolean(remote?.screen && remote?.cam && elements.remoteCameraVideo.srcObject),
        screen: false,
        label: `${state.peer?.name || 'Convidado'} · câmera`,
      },
      'local-main': {
        active: Boolean(local.cam || local.screen),
        screen: Boolean(local.screen),
        label: `${session.name} (você)${local.screen ? ' · tela' : ''}`,
      },
      'local-camera': {
        active: Boolean(local.screen && local.cam && elements.localCameraVideo.srcObject),
        screen: false,
        label: `${session.name} · câmera`,
      },
    });
    videoPiP.sync();
    if (state.role === 'host' && !state.peer) {
      if (local.cam || local.screen) hideOverlay();
      else showWaiting();
    }
  }

  function showWaiting() {
    if (state.ended) return;
    showOverlay(
      state.role === 'host' ? 'Aguardando o convidado' : 'Aguardando o host',
      state.role === 'host'
        ? 'Use Copiar link no canto superior para convidar alguém. A sala fica no ar enquanto o script rodar.'
        : 'A sala abre assim que o host entrar.',
    );
  }

  function updateRemoteCameraPreview() {
    updateSoloPreview();
  }

  function updateRemotePeer(peer) {
    if (!peer) {
      elements.remoteInitial.textContent = '…';
      elements.remoteLabel.textContent = 'Aguardando…';
      renderChips(elements.remoteChips, null);
      elements.remoteVideo.classList.add('hidden-media');
      elements.remoteVideo.classList.remove('screen');
      updateRemoteCameraPreview();
      return;
    }

    elements.remoteInitial.textContent = initialOf(peer.name);
    elements.remoteLabel.textContent = labelForPeer(peer);
    renderChips(elements.remoteChips, peer.media);
    elements.remoteVideo.classList.toggle(
      'hidden-media',
      !(peer.media?.cam || peer.media?.screen),
    );
    elements.remoteVideo.classList.toggle('screen', Boolean(peer.media?.screen));
    updateRemoteCameraPreview();
  }

  function labelForPeer(peer) {
    if (!peer) return 'Aguardando…';
    const suffix = peer.media?.screen ? ' · tela' : '';
    return `${peer.name}${suffix}`;
  }

  function renderChips(container, media) {
    const chips = [];
    if (media) {
      if (!media.mic && !media.screenAudio) chips.push('mudo');
      if (!media.cam && !media.screen) chips.push('câmera off');
    }
    container.replaceChildren(
      ...chips.map((text) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = text;
        return chip;
      }),
    );
  }

  function syncMediaUi(media) {
    elements.mic.setAttribute('aria-pressed', String(Boolean(media.mic)));
    elements.cam.setAttribute('aria-pressed', String(Boolean(media.cam)));
    elements.share.setAttribute('aria-pressed', String(Boolean(media.screen)));

    elements.micLabel.textContent = media.mic ? 'Mic on' : 'Mic off';
    elements.camLabel.textContent = media.cam ? 'Câmera on' : 'Câmera off';
    elements.shareLabel.textContent = media.screen ? 'Parar tela' : 'Tela';

    elements.localLabel.textContent = `${session.name} (você)${media.screen ? ' · tela' : ''}`;
    elements.localVideo.classList.toggle('screen', Boolean(media.screen));
    renderChips(elements.localChips, media);
  }

  function updateHostTools() {
    if (state.role !== 'host') return;
    elements.lock.textContent = state.locked ? 'Destrancar sala' : 'Trancar sala';
    elements.kick.disabled = !state.peer;
    elements.end.disabled = state.ended;
  }

  function initialOf(name) {
    return String(name || '?').trim().charAt(0).toUpperCase() || '?';
  }

  function appendMessage(message) {
    const article = document.createElement('article');
    article.className = `msg${message.from === socket.id ? ' self' : ''}`;

    const meta = document.createElement('div');
    meta.className = 'meta';

    const who = document.createElement('span');
    who.textContent = message.name;

    const role = document.createElement('span');
    role.className = 'role-tag';
    role.textContent = message.role === 'host' ? 'host' : 'convidado';

    const time = document.createElement('time');
    const date = new Date(message.ts);
    time.dateTime = date.toISOString();
    time.textContent = date.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    meta.append(who, role, time);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = message.text;

    article.append(meta, bubble);
    elements.messages.append(article);

    while (elements.messages.children.length > 300) {
      elements.messages.firstElementChild.remove();
    }

    elements.messages.scrollTop = elements.messages.scrollHeight;
  }

  function autoGrowInput() {
    elements.chatInput.style.height = 'auto';
    elements.chatInput.style.height = `${Math.min(elements.chatInput.scrollHeight, 120)}px`;
  }

  async function loadStatus() {
    clearTimeout(statusTimer);
    statusTimer = null;

    try {
      const status = await fetch('/api/status', {
        headers: { accept: 'application/json' },
      }).then((response) => response.json());
      publicUrl = status.publicUrl || null;
    } catch {
      publicUrl = null;
    }


    if (!publicUrl && state.role === 'host' && !state.ended && statusAttempts < 20) {
      statusAttempts += 1;
      statusTimer = setTimeout(() => {
        statusTimer = null;
        loadStatus();
      }, 3000);
    }
  }

  async function copyInvite() {
    if (state.role !== 'host' || state.ended || elements.copyLink.disabled) return;
    elements.copyLink.disabled = true;
    try {
      // Nova credencial revoga convites anteriores, expira em até 30 minutos
      // e só será aceita uma vez. Não expõe a senha nem a sessão do host.
      const response = await fetch(`/api/rooms/${encodeURIComponent(code)}/invite`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${session.token}`,
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast(payload.message || 'Não foi possível gerar um convite.');
        return;
      }
      await loadStatus();
      const origin = (publicUrl || location.origin).replace(/\/$/, '');
      const inviteUrl = `${origin}/${encodeURIComponent(code)}#invite=${encodeURIComponent(payload.token)}`;
      const ok = await copyText(inviteUrl);
      toast(ok
        ? (publicUrl ? 'Convite copiado. O convidado entra apenas com nome.'
          : 'Convite local copiado. Para acesso externo, configure o link público.')
        : 'Não foi possível copiar o convite. Tente novamente.');
    } catch {
      toast('Falha ao gerar o convite. Verifique a conexão com o servidor.');
    } finally {
      elements.copyLink.disabled = false;
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback para navegadores sem clipboard API
    }

    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function toast(message) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 4200);
  }

  function endSession(title, text) {
    if (state.ended) return;
    state.ended = true;
    clearTimeout(statusTimer);

    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // sem sessionStorage
    }

    videoPiP.destroy();
    rtc.destroy();
    socket.disconnect();
    remotePlayback.destroy();

    setConnection('off', 'encerrada');
    for (const control of [
      elements.mic,
      elements.cam,
      elements.share,
      elements.chatInput,
      elements.chatSend,
      elements.lock,
      elements.kick,
      elements.end,
      elements.leave,
      elements.copyLink,
    ]) {
      control.disabled = true;
    }

    updateHostTools();
    videoLayout.destroy();
    showOverlay(title, text, 'Voltar ao início', () => {
      location.replace('/');
    });
  }

  window.addEventListener('beforeunload', () => {
    rtc.destroy();
  });
}