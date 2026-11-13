/**
 * Reprodução de áudio remoto independente dos vídeos e do layout da sala.
 * As duas mídias compartilham a sessão WebRTC, mas não o elemento HTML.
 */
export function createRemotePlayback({ audio, video, muteButton, onBlocked = () => {} }) {
  let audioTrack = null;
  let videoTrack = null;
  let muted = false;
  let peerPresent = false;
  let blockedNotified = false;

  video.muted = true;
  audio.autoplay = true;

  function syncMuteButton() {
    muteButton.hidden = !peerPresent;
    muteButton.disabled = !peerPresent;
    muteButton.setAttribute('aria-pressed', String(muted));
    muteButton.textContent = muted ? 'Ouvir áudio' : 'Mutar áudio';
    muteButton.title = muted ? 'Voltar a ouvir o convidado' : 'Mutar o som do convidado';
    audio.muted = muted;
  }

  function playAudio() {
    if (!audioTrack || muted || !audio.paused) return;
    try {
      const attempt = audio.play();
      attempt?.then?.(() => {
        blockedNotified = false;
      }).catch?.((error) => {
        if (error?.name === 'NotAllowedError' && !blockedNotified) {
          blockedNotified = true;
          onBlocked();
        }
      });
    } catch (error) {
      if (error?.name === 'NotAllowedError' && !blockedNotified) {
        blockedNotified = true;
        onBlocked();
      }
    }
  }

  function playVideo() {
    if (!videoTrack || !video.paused) return;
    try {
      video.play()?.catch?.(() => {});
    } catch {
      // Vídeo remoto é mudo; o navegador pode ainda adiar a reprodução.
    }
  }

  function onAudioUnmute() {
    playAudio();
  }

  function attach(stream) {
    const nextAudio = stream?.getAudioTracks()?.[0] || null;
    const nextVideo = stream?.getVideoTracks()?.[0] || null;

    if (nextAudio !== audioTrack) {
      audioTrack?.removeEventListener?.('unmute', onAudioUnmute);
      audioTrack = nextAudio;
      audio.srcObject = nextAudio ? new MediaStream([nextAudio]) : null;
      nextAudio?.addEventListener?.('unmute', onAudioUnmute);
      blockedNotified = false;
    }
    if (nextVideo !== videoTrack) {
      videoTrack = nextVideo;
      video.srcObject = nextVideo ? new MediaStream([nextVideo]) : null;
    }
    playVideo();
    playAudio();
  }

  function toggleMute() {
    muted = !muted;
    syncMuteButton();
    if (!muted) playAudio();
  }

  function setPeerPresent(present) {
    peerPresent = Boolean(present);
    if (!peerPresent) attach(null);
    syncMuteButton();
  }

  // Uma interação normal com a página também libera áudio caso o navegador
  // tenha inicialmente bloqueado o autoplay de uma nova conexão WebRTC.
  function onGesture() {
    playAudio();
  }

  muteButton.addEventListener('click', toggleMute);
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('keydown', onGesture, true);
  syncMuteButton();

  return {
    attach,
    playAudio,
    setPeerPresent,
    get muted() { return muted; },
    destroy() {
      muteButton.removeEventListener('click', toggleMute);
      document.removeEventListener('pointerdown', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
      attach(null);
      peerPresent = false;
      syncMuteButton();
    },
  };
}
