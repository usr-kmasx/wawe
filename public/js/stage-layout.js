/**
 * Layout local das transmissões. Não altera as trilhas WebRTC nem envia
 * mensagens ao outro participante: cada navegador escolhe seu próprio foco.
 */
export function createVideoStage({ container, tiles, overlay, onPictureInPicture = null }) {
  const order = ['remote-main', 'local-main', 'remote-camera', 'local-camera'];
  const nodes = new Map();
  const geometry = new Map(); // Preferência do usuário (não é reduzida pelo refluxo).
  const renderedGeometry = new Map(); // Posições temporárias sem colisões.
  const videoDimensionListeners = [];
  let focused = null;
  let active = new Map();
  let screens = new Set();
  let moving = false;
  let movingKey = null; // A miniatura arrastada tem prioridade sobre as demais.
  let suppressTouchClickKey = null;
  let hideControlsTimer = null;
  const CONTROLS_IDLE_MS = 3000;
  const MIN_THUMB_WIDTH = 120;

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

    const pictureInPicture = document.createElement('button');
    pictureInPicture.type = 'button';
    pictureInPicture.className = 'feed-pip';
    pictureInPicture.setAttribute('aria-label', 'Abrir vídeo em janela flutuante');
    pictureInPicture.title = 'Vídeo em janela flutuante';
    pictureInPicture.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><rect x="11" y="11" width="8" height="7" rx="1"/></svg>';
    pictureInPicture.hidden = !onPictureInPicture;
    pictureInPicture.addEventListener('click', (event) => {
      event.stopPropagation();
      if (active.get(key)?.active) onPictureInPicture?.(key);
    });

    tile.append(drag, focusButton, resize, fullscreen, pictureInPicture);
    tile.addEventListener('click', (event) => {
      if (suppressTouchClickKey === key) {
        suppressTouchClickKey = null;
        return; // Primeiro toque abre os controles sem trocar o foco.
      }
      if (moving || event.target.closest('.feed-drag, .feed-resize, .feed-fullscreen, .feed-pip')) return;
      select(key);
    });
    focusButton.addEventListener('click', (event) => {
      event.stopPropagation();
      select(key);
    });
    wirePointer(drag, key, 'drag');
    wirePointer(resize, key, 'resize');
    nodes.set(key, { tile, label: details.label, video: details.video, fullscreen });
    // Metadados chegam após a trilha ou mudam quando a câmera altera resolução.
    const onDimensions = () => render();
    details.video.addEventListener('loadedmetadata', onDimensions);
    details.video.addEventListener('resize', onDimensions);
    videoDimensionListeners.push([details.video, onDimensions]);
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

  function onFullscreenChange() {
    // O ResizeObserver cobre o novo tamanho real; este evento também atualiza
    // imediatamente a posição quando o navegador entra ou sai do fullscreen.
    render();
  }

  document.addEventListener('fullscreenchange', onFullscreenChange);
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
      if (!wasVisible && !event.target?.closest?.('.feed-focus, .feed-drag, .feed-resize, .feed-fullscreen, .feed-pip')) {
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
    const w = Math.min(220, Math.max(MIN_THUMB_WIDTH, width * 0.34), width - gap * 2);
    const h = Math.min(Math.round(w * 0.625), Math.max(70, height - gap * 2));
    return { w: Math.round(w), h: Math.round(h) };
  }

  function fit(pos, { allowSmall = false } = {}) {
    const { width, height, gap } = bounds();
    const freeWidth = Math.max(1, width - gap * 2);
    const freeHeight = Math.max(1, height - gap * 2);
    const w = clamp(pos.w, allowSmall ? 1 : Math.min(MIN_THUMB_WIDTH, freeWidth), freeWidth);
    const h = clamp(pos.h, allowSmall ? 1 : Math.min(70, freeHeight), freeHeight);
    return {
      w: Math.round(w),
      h: Math.round(h),
      x: Math.round(clamp(pos.x, gap, width - gap - w)),
      y: Math.round(clamp(pos.y, gap, height - gap - h)),
    };
  }

  // Somente câmeras usam a proporção da fonte. Compartilhamentos de tela
  // mantêm o dimensionamento anterior, sem recorte de conteúdo.
  function cameraAspect(key) {
    if (active.get(key)?.screen) return null;
    const video = nodes.get(key)?.video;
    if (!video) return null;
    const settings = video.srcObject?.getVideoTracks?.()?.[0]?.getSettings?.();
    const width = Number(video.videoWidth) || Number(settings?.width);
    const height = Number(video.videoHeight) || Number(settings?.height);
    if (!(width > 0 && height > 0)) return null;
    const ratio = width / height;
    return Number.isFinite(ratio) && ratio >= .1 && ratio <= 10 ? ratio : null;
  }

  function fitCamera(pos, key, { enforceMinimum = false } = {}) {
    const aspect = cameraAspect(key);
    if (!aspect) return fit(pos, { allowSmall: !enforceMinimum });
    const { width, height, gap } = bounds();
    const freeWidth = Math.max(1, width - gap * 2);
    const freeHeight = Math.max(1, height - gap * 2);
    const maxWidth = Math.max(1, Math.min(freeWidth, Math.floor(freeHeight * aspect)));
    const minWidth = enforceMinimum ? Math.min(MIN_THUMB_WIDTH, maxWidth) : 1;
    const w = Math.round(clamp(pos.w, minWidth, maxWidth));
    return fit({ ...pos, w, h: Math.max(1, Math.round(w / aspect)) },
      { allowSmall: true });
  }

  // Uma posição ajustada pelo usuário é guardada como fração do espaço livre.
  // Fração 0/1 mantém a miniatura ancorada nas bordas durante fullscreen;
  // valores intermediários preservam a posição proporcional no palco.
  function rememberGeometry(key, pos) {
    const { width, height, gap } = bounds();
    const travelX = Math.max(0, width - gap * 2 - pos.w);
    const travelY = Math.max(0, height - gap * 2 - pos.h);
    geometry.set(key, {
      ...pos,
      relativeX: travelX ? clamp((pos.x - gap) / travelX, 0, 1) : 0,
      relativeY: travelY ? clamp((pos.y - gap) / travelY, 0, 1) : 0,
    });
  }

  function preferredPosition(key, index) {
    const saved = geometry.get(key);
    if (!saved) return defaultPosition(index);
    const { width, height, gap } = bounds();
    return {
      w: saved.w,
      h: saved.h,
      x: Math.round(gap + saved.relativeX * Math.max(0, width - gap * 2 - saved.w)),
      y: Math.round(gap + saved.relativeY * Math.max(0, height - gap * 2 - saved.h)),
    };
  }

  // Redimensionar pelo canto inferior direito não deve soltar uma miniatura
  // que já estava encaixada na borda direita ou inferior.
  function keepResizedEdges(previous, resized) {
    const { width, height, gap } = bounds();
    const result = { ...resized };
    if (Math.abs(width - gap - previous.x - previous.w) <= 2) {
      result.x = width - gap - result.w;
    }
    if (Math.abs(height - gap - previous.y - previous.h) <= 2) {
      result.y = height - gap - result.h;
    }
    return fit(result, { allowSmall: true });
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

  function overlaps(a, b, clearance) {
    return a.x < b.x + b.w + clearance && a.x + a.w + clearance > b.x
      && a.y < b.y + b.h + clearance && a.y + a.h + clearance > b.y;
  }

  // Primeiro tenta preservar pelo menos 120px para cada miniatura.
  // Se não houver espaço, o renderizador recorre a um reflow compacto antes
  // de permitir reduções excepcionais abaixo do mínimo.
  function freePosition(requested, placed, clearance, aspect = null, minWidth = 1) {
    const { width, height, gap } = bounds();
    const freeWidth = Math.max(1, width - gap * 2);
    const freeHeight = Math.max(1, height - gap * 2);
    const requestedX = requested.x;
    const requestedY = requested.y;
    const ratio = aspect || requested.w / Math.max(1, requested.h);
    const maxWidth = Math.max(1, Math.min(freeWidth, Math.floor(freeHeight * ratio)));
    if (maxWidth < minWidth) return null;
    const scales = [1, .9, .8, .7, .6, .5, .4, .3, .2, .1];
    const widths = [...new Set([
      ...scales.map((scale) => Math.min(maxWidth, Math.round(requested.w * scale))),
      minWidth,
    ].filter((w) => w >= minWidth && w <= maxWidth))];

    for (const w of widths) {
      const h = Math.max(1, Math.round(w / ratio));
      const clampX = (x) => Math.round(clamp(x, gap, width - gap - w));
      const clampY = (y) => Math.round(clamp(y, gap, height - gap - h));
      const xs = [requestedX, gap, width - gap - w];
      const ys = [requestedY, gap, height - gap - h];
      for (const pos of placed) {
        xs.push(pos.x + pos.w + clearance, pos.x - w - clearance);
        ys.push(pos.y + pos.h + clearance, pos.y - h - clearance);
      }
      let best = null;
      let bestScore = Infinity;
      for (const xValue of xs) {
        for (const yValue of ys) {
          const candidate = { x: clampX(xValue), y: clampY(yValue), w, h };
          if (placed.some((pos) => overlaps(candidate, pos, clearance))) continue;
          const dx = candidate.x - requestedX;
          const dy = candidate.y - requestedY;
          const score = dx * dx + 1.3 * dy * dy;
          if (score < bestScore) {
            bestScore = score;
            best = candidate;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // Quando o fluxo anterior não encontra espaço, tenta layouts em fileiras
  // com todas as miniaturas >= 120px, antes de reduzir qualquer uma.
  function compactAtMinimum(keys, original) {
    const { width, height, gap } = bounds();
    const size = keys.map((key) => {
      const pos = original.get(key);
      const ratio = cameraAspect(key) || pos.w / Math.max(1, pos.h);
      return { w: MIN_THUMB_WIDTH, h: Math.max(1, Math.round(MIN_THUMB_WIDTH / ratio)) };
    });
    for (let columns = keys.length; columns >= 1; columns -= 1) {
      const result = new Map();
      let y = gap;
      let valid = true;
      for (let start = 0; start < keys.length; start += columns) {
        const rowSizes = size.slice(start, start + columns);
        const neededWidth = rowSizes.reduce((sum, item) => sum + item.w, 0)
          + (rowSizes.length - 1) * gap;
        const rowHeight = Math.max(...rowSizes.map((item) => item.h));
        if (neededWidth > width - gap * 2 || y + rowHeight > height - gap) {
          valid = false;
          break;
        }
        let x = gap;
        for (let i = 0; i < rowSizes.length; i += 1) {
          result.set(keys[start + i], { x, y, ...rowSizes[i] });
          x += rowSizes[i].w + gap;
        }
        y += rowHeight + gap;
      }
      if (valid) return result;
    }
    return null;
  }

  function render() {
    let floatingIndex = 0;
    const floating = order.filter((key) => active.get(key)?.active && key !== focused);
    const original = new Map(floating.map((key, index) => [key,
      fitCamera(preferredPosition(key, index), key)]));
    renderedGeometry.clear();
    const priority = movingKey && floating.includes(movingKey)
      ? [movingKey, ...floating.filter((key) => key !== movingKey)]
      : floating;
    const placed = [];
    let noSpace = false;
    for (const key of priority) {
      const pos = freePosition(original.get(key), placed, bounds().gap,
        cameraAspect(key), MIN_THUMB_WIDTH);
      if (!pos) {
        noSpace = true;
        break;
      }
      renderedGeometry.set(key, pos);
      placed.push(pos);
    }
    if (noSpace && floating.length) {
      const compact = compactAtMinimum(priority, original);
      renderedGeometry.clear();
      if (compact) {
        for (const [key, pos] of compact) renderedGeometry.set(key, pos);
      } else {
        // Só reduz abaixo de 120px quando nem a organização compacta cabe.
        const fallback = [];
        let impossible = false;
        for (const key of priority) {
          const pos = freePosition(original.get(key), fallback, bounds().gap,
            cameraAspect(key));
          if (!pos) {
            impossible = true;
            break;
          }
          renderedGeometry.set(key, pos);
          fallback.push(pos);
        }
        if (impossible) {
          // Última opção: distribuir em coluna, sem encobrir outra miniatura.
          const { width, height, gap } = bounds();
          const availableHeight = Math.max(floating.length, height - gap * 2);
          const clearance = Math.max(0, Math.min(gap,
            Math.floor((availableHeight - floating.length) / (floating.length - 1 || 1))));
          const heightPerTile = Math.max(1, Math.floor(
            (availableHeight - (floating.length - 1) * clearance) / floating.length));
          const widthPerTile = Math.max(1, Math.min(220, width - gap * 2));
          floating.forEach((key, index) => {
            const aspect = cameraAspect(key);
            const w = aspect
              ? Math.max(1, Math.min(widthPerTile, Math.floor(heightPerTile * aspect)))
              : widthPerTile;
            renderedGeometry.set(key, {
              x: gap,
              y: gap + index * (heightPerTile + clearance),
              w,
              h: aspect ? Math.max(1, Math.round(w / aspect)) : heightPerTile,
            });
          });
        }
      }
    }
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
      const aspect = cameraAspect(key);
      item.tile.classList.toggle('native-camera-ratio', Boolean(aspect));
      item.fullscreen.hidden = !isFocused;
      item.tile.setAttribute('aria-label', info.label);
      if (isFocused) {
        if (aspect) {
          // Câmera em destaque: a moldura também segue o formato original.
          // O palco pode ter área vazia, mas não há faixas dentro do vídeo.
          const { width, height, gap } = bounds();
          const margin = document.fullscreenElement === container ? 0 : gap;
          const w = Math.max(1, Math.min(width - margin * 2,
            (height - margin * 2) * aspect));
          const h = Math.max(1, w / aspect);
          item.tile.style.left = Math.round((width - w) / 2) + 'px';
          item.tile.style.top = Math.round((height - h) / 2) + 'px';
          item.tile.style.width = Math.round(w) + 'px';
          item.tile.style.height = Math.round(h) + 'px';
        } else {
          item.tile.style.left = '';
          item.tile.style.top = '';
          item.tile.style.width = '';
          item.tile.style.height = '';
        }
      } else {
        const pos = renderedGeometry.get(key) || defaultPosition(floatingIndex);
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
      movingKey = key;
      control.setPointerCapture(event.pointerId);
      const base = fit(renderedGeometry.get(key) || preferredPosition(key, 0),
        { allowSmall: true });
      const startX = event.clientX;
      const startY = event.clientY;

      const onMove = (moveEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const aspect = cameraAspect(key);
        const deltaWidth = aspect && Math.abs(dy * aspect) > Math.abs(dx)
          ? dy * aspect : dx;
        const next = mode === 'drag'
          ? { ...base, x: base.x + dx, y: base.y + dy }
          : { ...base, w: base.w + deltaWidth,
            h: aspect ? (base.w + deltaWidth) / aspect : base.h + dy };
        const updated = mode === 'resize'
          ? keepResizedEdges(base, fitCamera(next, key, { enforceMinimum: true }))
          : fit(next, { allowSmall: true });
        rememberGeometry(key, updated);
        render();
      };
      const finish = () => {
        control.removeEventListener('pointermove', onMove);
        control.removeEventListener('pointerup', finish);
        control.removeEventListener('pointercancel', finish);
        try { control.releasePointerCapture(event.pointerId); } catch {}
        // Preserva onde as outras miniaturas foram empurradas, sem gravar
        // o tamanho reduzido automaticamente (ele deve voltar ao ampliar).
        for (const other of order) {
          if (other === key || !renderedGeometry.has(other)) continue;
          const placed = renderedGeometry.get(other);
          const desired = geometry.get(other) || placed;
          rememberGeometry(other, { ...desired, x: placed.x, y: placed.y });
        }
        moving = false;
        movingKey = null;
        render();
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
      const pos = renderedGeometry.get(key) || preferredPosition(key, 0);
      const aspect = cameraAspect(key);
      const resized = mode === 'drag'
        ? { ...pos, x: pos.x + delta[0], y: pos.y + delta[1] }
        : { ...pos,
          w: pos.w + (aspect ? (delta[0] || delta[1] * aspect) : delta[0]),
          h: aspect ? (pos.w + (delta[0] || delta[1] * aspect)) / aspect
            : pos.h + delta[1],
        };
      const updated = mode === 'resize'
        ? keepResizedEdges(pos, fitCamera(resized, key, { enforceMinimum: true }))
        : fit(resized, { allowSmall: true });
      rememberGeometry(key, updated);
      render();
    });
  }

  return {
    refresh,
    destroy: () => {
      observer?.disconnect();
      for (const [video, onDimensions] of videoDimensionListeners) {
        video.removeEventListener('loadedmetadata', onDimensions);
        video.removeEventListener('resize', onDimensions);
      }
      container.classList.remove('cursor-idle');
      clearTimeout(hideControlsTimer);
      document.removeEventListener('pointerdown', onPointerDown, true);
      container.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('keydown', onEscape, true);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    },
  };
}
