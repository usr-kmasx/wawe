/**
 * Layout local das transmissões. Não altera as trilhas WebRTC nem envia
 * mensagens ao outro participante: cada navegador escolhe seu próprio foco.
 */
export function createVideoStage({ container, tiles, overlay }) {
  const order = ['remote-main', 'local-main', 'remote-camera', 'local-camera'];
  const nodes = new Map();
  const geometry = new Map();
  let focused = null;
  let active = new Map();
  let screens = new Set();
  let moving = false;
  let suppressTouchClickKey = null;
  let hideControlsTimer = null;
  const CONTROLS_IDLE_MS = 3000;

  for (const key of order) {
    const details = tiles[key];
    let tile = details.tile;

    // As trilhas auxiliares passam a ser miniaturas independentes.
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'tile camera-feed';
      tile.hidden = true;
      details.video.classList.remove('camera-pip');
      details.video.hidden = false;
      tile.append(details.video);
      const label = document.createElement('div');
      label.className = 'tile-label';
      tile.append(label);
      details.label = label;
      container.insertBefore(tile, overlay);
    }

    tile.classList.add('stage-feed');
    tile.dataset.feed = key;

    const focusButton = document.createElement('button');
    focusButton.type = 'button';
    focusButton.className = 'feed-focus';
    focusButton.textContent = 'Destacar';
    focusButton.title = 'Mostrar esta transmissão em destaque';

    const drag = document.createElement('button');
    drag.type = 'button';
    drag.className = 'feed-drag';
    drag.textContent = 'Mover';
    drag.title = 'Arrastar miniatura; use as setas para movê-la';
    drag.setAttribute('aria-label', 'Mover miniatura');

    const resize = document.createElement('button');
    resize.type = 'button';
    resize.className = 'feed-resize';
    resize.textContent = '↘';
    resize.title = 'Arrastar para mudar tamanho; use as setas para ajustar';
    resize.setAttribute('aria-label', 'Redimensionar miniatura');

    const fullscreen = document.createElement('button');
    fullscreen.type = 'button';
    fullscreen.className = 'feed-fullscreen';
    fullscreen.hidden = true;
    fullscreen.setAttribute('aria-label', 'Entrar em tela cheia');
    fullscreen.title = 'Tela cheia';
    fullscreen.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3"/></svg>';
    fullscreen.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleFullscreen(key);
    });

    tile.append(drag, focusButton, resize, fullscreen);
    tile.addEventListener('click', (event) => {
      if (suppressTouchClickKey === key) {
        suppressTouchClickKey = null;
        return; // Primeiro toque abre os controles sem trocar o foco.
      }
      if (moving || event.target.closest('.feed-drag, .feed-resize, .feed-fullscreen')) return;
      select(key);
    });
    focusButton.addEventListener('click', (event) => {
      event.stopPropagation();
      select(key);
    });
    wirePointer(drag, key, 'drag');
    wirePointer(resize, key, 'resize');
    nodes.set(key, { tile, label: details.label, video: details.video, fullscreen });
  }

  container.classList.add('custom-stage');

  function syncFullscreenButtons() {
    const stageFullscreen = document.fullscreenElement === container;
    for (const [key, { fullscreen }] of nodes) {
      const isFullscreen = stageFullscreen && key === focused;
      fullscreen.setAttribute('aria-label', isFullscreen ? 'Sair da tela cheia' : 'Entrar em tela cheia');
      fullscreen.title = isFullscreen ? 'Sair da tela cheia' : 'Tela cheia';
      fullscreen.setAttribute('aria-pressed', String(isFullscreen));
    }
  }

  async function toggleFullscreen(key) {
    if (!nodes.has(key) || focused !== key || !active.get(key)?.active) return;
    try {
      if (document.fullscreenElement === container) {
        await document.exitFullscreen();
      } else if (container.requestFullscreen) {
        // Ampliar o palco (não a tile), mantendo as miniaturas no mesmo layout.
        await container.requestFullscreen();
      }
    } catch {
      // O navegador pode não permitir tela cheia; mantém o layout intacto.
    }
    syncFullscreenButtons();
  }

  document.addEventListener('fullscreenchange', syncFullscreenButtons);
  syncFullscreenButtons();

  function hideControls() {
    if (moving) {
      clearTimeout(hideControlsTimer);
      hideControlsTimer = setTimeout(hideControls, CONTROLS_IDLE_MS);
      return;
    }
    clearTimeout(hideControlsTimer);
    hideControlsTimer = null;
    for (const { tile } of nodes.values()) tile.classList.remove('controls-visible');
    container.classList.add('cursor-idle');
  }

  function showControls(tile) {
    clearTimeout(hideControlsTimer);
    container.classList.remove('cursor-idle');
    for (const item of nodes.values()) {
      item.tile.classList.toggle('controls-visible',
        item.tile === tile && !item.tile.hidden);
    }
    hideControlsTimer = setTimeout(hideControls, CONTROLS_IDLE_MS);
  }

  function onPointerDown(event) {
    const isTouch = event.pointerType === 'touch' || event.pointerType === 'pen';
    const tile = event.target?.closest?.('.stage-feed');
    const key = tile?.dataset?.feed;
    const valid = key && nodes.get(key)?.tile === tile && active.get(key)?.active;

    if (isTouch) {
      suppressTouchClickKey = null;
      if (!valid) {
        hideControls(); // Toque fora da miniatura também fecha os controles.
        return;
      }
      const wasVisible = tile.classList.contains('controls-visible');
      showControls(tile);
      if (!wasVisible && !event.target?.closest?.('.feed-focus, .feed-drag, .feed-resize, .feed-fullscreen')) {
        suppressTouchClickKey = key; // Primeiro toque revela, sem destacar.
      }
    } else if (valid) {
      showControls(tile);
    }
  }

  function onPointerMove(event) {
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    const tile = event.target?.closest?.('.stage-feed');
    const key = tile?.dataset?.feed;
    showControls(key && nodes.get(key)?.tile === tile && active.get(key)?.active ? tile : null);
  }

  function onEscape(event) {
    if (event.key === 'Escape') hideControls();
  }

  document.addEventListener('pointerdown', onPointerDown, true);
  container.addEventListener('pointermove', onPointerMove);
  document.addEventListener('keydown', onEscape, true);
  hideControlsTimer = setTimeout(hideControls, CONTROLS_IDLE_MS);
  const observer = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => render())
    : null;
  observer?.observe(container);

  function bounds() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const gap = width <= 620 ? 10 : 16;
    return { width, height, gap };
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  function initialSize() {
    const { width, height, gap } = bounds();
    const w = Math.min(220, Math.max(100, width * 0.34), width - gap * 2);
    const h = Math.min(Math.round(w * 0.625), Math.max(70, height - gap * 2));
    return { w: Math.round(w), h: Math.round(h) };
  }

  function fit(pos) {
    const { width, height, gap } = bounds();
    const w = clamp(pos.w, Math.min(100, width - gap * 2), width - gap * 2);
    const h = clamp(pos.h, Math.min(70, height - gap * 2), height - gap * 2);
    return {
      w: Math.round(w),
      h: Math.round(h),
      x: Math.round(clamp(pos.x, gap, width - gap - w)),
      y: Math.round(clamp(pos.y, gap, height - gap - h)),
    };
  }

  function defaultPosition(index) {
    const { width, height, gap } = bounds();
    const size = initialSize();
    const places = [
      { x: width - gap - size.w, y: gap },
      { x: width - gap - size.w, y: height - gap - size.h },
      { x: gap, y: height - gap - size.h },
    ];
    return fit({ ...places[index % places.length], ...size });
  }

  function render() {
    let floatingIndex = 0;
    for (const key of order) {
      const item = nodes.get(key);
      const info = active.get(key);
      const isActive = !!info?.active;
      item.tile.hidden = !isActive;
      if (!isActive) {
        item.tile.classList.remove('controls-visible');
        item.fullscreen.hidden = true;
        continue;
      }
      item.label.textContent = info.label;
      const isFocused = key === focused;
      item.tile.classList.toggle('focused', isFocused);
      item.tile.classList.toggle('floating', !isFocused);
      item.fullscreen.hidden = !isFocused;
      item.tile.setAttribute('aria-label', info.label);
      if (isFocused) {
        item.tile.style.left = '';
        item.tile.style.top = '';
        item.tile.style.width = '';
        item.tile.style.height = '';
      } else {
        const pos = fit(geometry.get(key) || defaultPosition(floatingIndex));
        geometry.set(key, pos);
        item.tile.style.left = pos.x + 'px';
        item.tile.style.top = pos.y + 'px';
        item.tile.style.width = pos.w + 'px';
        item.tile.style.height = pos.h + 'px';
        floatingIndex += 1;
      }
    }
    syncFullscreenButtons();
  }

  function select(key) {
    if (!active.get(key)?.active || key === focused) return;
    focused = key;
    hideControls();
    render();
  }

  function refresh(next) {
    const previousScreens = screens;
    active = new Map(order.map((key) => [key, next[key] || { active: false }]));
    const enabled = order.filter((key) => active.get(key).active);
    screens = new Set(enabled.filter((key) => active.get(key).screen));
    const newlyShared = [...screens].find((key) => !previousScreens.has(key));
    if (newlyShared) {
      focused = newlyShared;
      hideControls();
    } else if (!active.get(focused)?.active) {
      focused = enabled.find((key) => active.get(key).screen) || enabled[0] || null;
      hideControls();
    }
    render();
  }

  function wirePointer(control, key, mode) {
    control.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !nodes.get(key).tile.classList.contains('floating')) return;
      event.preventDefault();
      event.stopPropagation();
      moving = true;
      control.setPointerCapture(event.pointerId);
      const base = fit(geometry.get(key) || defaultPosition(0));
      const startX = event.clientX;
      const startY = event.clientY;

      const onMove = (moveEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const next = mode === 'drag'
          ? { ...base, x: base.x + dx, y: base.y + dy }
          : { ...base, w: base.w + dx, h: base.h + dy };
        geometry.set(key, fit(next));
        render();
      };
      const finish = () => {
        control.removeEventListener('pointermove', onMove);
        control.removeEventListener('pointerup', finish);
        control.removeEventListener('pointercancel', finish);
        try { control.releasePointerCapture(event.pointerId); } catch {}
        moving = false;
        showControls(nodes.get(key).tile);
      };
      control.addEventListener('pointermove', onMove);
      control.addEventListener('pointerup', finish);
      control.addEventListener('pointercancel', finish);
    });

    control.addEventListener('keydown', (event) => {
      const offsets = {
        ArrowLeft: [-12, 0],
        ArrowRight: [12, 0],
        ArrowUp: [0, -12],
        ArrowDown: [0, 12],
      };
      const delta = offsets[event.key];
      if (!delta || !nodes.get(key).tile.classList.contains('floating')) return;
      event.preventDefault();
      const pos = geometry.get(key) || defaultPosition(0);
      geometry.set(key, fit(mode === 'drag'
        ? { ...pos, x: pos.x + delta[0], y: pos.y + delta[1] }
        : { ...pos, w: pos.w + delta[0], h: pos.h + delta[1] }));
      render();
    });
  }

  return {
    refresh,
    destroy: () => {
      observer?.disconnect();
      container.classList.remove('cursor-idle');
      clearTimeout(hideControlsTimer);
      document.removeEventListener('pointerdown', onPointerDown, true);
      container.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('keydown', onEscape, true);
      document.removeEventListener('fullscreenchange', syncFullscreenButtons);
    },
  };
}
