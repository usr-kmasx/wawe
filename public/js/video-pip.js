/**
 * Janela PiP individual. Apenas reproduz uma trilha de vídeo já recebida/capturada:
 * não duplica captura, não transfere nós da sala e não reproduz áudio.
 */
export function createVideoPiP({ sources, isActive = () => true, onError = () => {} }) {
  let pipWindow = null;
  let pipVideo = null;
  let selectedKey = null;
  let currentTrack = null;
  let opening = false;

  const supported = Boolean(globalThis.documentPictureInPicture?.requestWindow);

  function clear() {
    pipWindow = null;
    pipVideo = null;
    selectedKey = null;
    currentTrack = null;
  }

  function close() {
    const oldWindow = pipWindow;
    clear();
    if (oldWindow && !oldWindow.closed) oldWindow.close();
  }

  function selectedTrack(key) {
    if (!isActive(key)) return null;
    const source = sources[key];
    const track = source?.srcObject?.getVideoTracks?.()[0];
    return track?.readyState === 'ended' ? null : track || null;
  }

  function sync() {
    if (!pipWindow || pipWindow.closed || !selectedKey) return;
    const track = selectedTrack(selectedKey);
    if (!track) {
      close();
      return;
    }
    if (track !== currentTrack) {
      currentTrack = track;
      // Apenas vídeo: áudio remoto segue exclusivamente no player original.
      pipVideo.srcObject = new MediaStream([track]);
      pipVideo.play()?.catch(() => {});
    }
  }

  function setSource(key) {
    if (!sources[key]) return;
    selectedKey = key;
    sync();
  }

  async function toggle(key) {
    if (!supported || !sources[key]) {
      onError('Seu navegador não oferece janelas flutuantes de chamada.');
      return;
    }
    if (pipWindow && !pipWindow.closed) {
      if (selectedKey === key) close();
      else setSource(key);
      return;
    }
    if (opening) return;

    const track = selectedTrack(key);
    if (!track) {
      onError('Ative ou aguarde o vídeo antes de abrir a janela flutuante.');
      return;
    }
    opening = true;
    try {
      // Precisa ser chamado antes de qualquer await: requer gesto do usuário.
      const win = await globalThis.documentPictureInPicture.requestWindow({
        width: 420,
        height: 260,
      });
      pipWindow = win;
      win.document.title = 'Wawe · vídeo flutuante';
      const css = win.document.createElement('link');
      css.rel = 'stylesheet';
      css.href = '/css/pip.css';
      win.document.head.append(css);

      pipVideo = win.document.createElement('video');
      pipVideo.autoplay = true;
      pipVideo.muted = true;
      pipVideo.defaultMuted = true;
      pipVideo.playsInline = true;
      pipVideo.disablePictureInPicture = true;
      win.document.body.append(pipVideo);

      win.addEventListener('pagehide', () => {
        if (pipWindow === win) clear();
      }, { once: true });
      setSource(key);
    } catch (error) {
      close();
      if (error?.name !== 'NotAllowedError') {
        onError('Não foi possível abrir a janela flutuante.');
      } else {
        onError('Autorize a abertura da janela flutuante pelo navegador.');
      }
    } finally {
      opening = false;
    }
  }

  return {
    supported,
    toggle,
    sync,
    close,
    destroy: close,
    get selectedKey() { return selectedKey; },
  };
}
