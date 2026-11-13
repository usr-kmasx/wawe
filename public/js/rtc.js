import { bitrateFor, captureConstraints, getProfile, resolveQuality, setSenderBitrate } from './video-quality.js';
import { OutgoingAudio } from './outgoing-audio.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

function emptyRemoteStream() {
  return new MediaStream();
}

/**
 * Cuida de uma única conexão peer-to-peer.
 * A conexão reserva áudio, vídeo principal e câmera auxiliar.
 * Assim, a tela e a câmera podem ser transmitidas simultaneamente.
 */
export class PeerSession {
  constructor({ socket, callbacks = {} }) {
    this.socket = socket;
    this.callbacks = callbacks;
    this.pc = null;
    this.role = 'idle';
    this.senders = { audio: null, video: null, camera: null };
    this.pendingIce = [];
    this.micTrack = null;
    this.camTrack = null;
    this.screenTrack = null;
    this.screenAudioTrack = null;
    this.outgoingAudio = new OutgoingAudio({
      onMixUnavailable: () => this.callbacks.onError?.('O navegador não conseguiu misturar microfone e áudio da tela. Apenas o áudio da tela será enviado.'),
    });
    this.micEnabled = false;
    this.camEnabled = false;
    this.quality = { camera: 'balanced', screen: 'high' };
    this.qualitySettings = { camera: getProfile('balanced'), screen: getProfile('high') };
    this.remoteStream = emptyRemoteStream();
  }

  get hasPeer() {
    return Boolean(this.pc);
  }

  get mediaState() {
    return {
      mic: Boolean(this.micTrack && this.micEnabled),
      cam: Boolean(this.camTrack && this.camEnabled),
      screen: Boolean(this.screenTrack),
      screenAudio: Boolean(this.screenTrack && this.screenAudioTrack && this.screenAudioTrack.readyState !== 'ended'),
    };
  }

  createPeerConnection() {
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      bundlePolicy: 'max-bundle',
    });
    this.pc = pc;
    this.remoteStream = emptyRemoteStream();

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const candidate = event.candidate.toJSON
        ? event.candidate.toJSON()
        : event.candidate;
      this.socket.emit('rtc:ice', { candidate });
    };

    pc.ontrack = (event) => {
      const videoReceivers = pc.getTransceivers().filter(
        (transceiver) => transceiver.receiver?.track?.kind === 'video',
      );
      if (event.track.kind === 'video' && event.transceiver === videoReceivers[1]) {
        this.callbacks.onRemoteCameraStream?.(new MediaStream([event.track]));
        return;
      }
      const tracks = [event.track];
      for (const track of tracks) {
        if (!this.remoteStream.getTracks().some((item) => item.id === track.id)) {
          this.remoteStream.addTrack(track);
        }
      }
      this.callbacks.onRemoteStream?.(this.remoteStream);
    };

    pc.onconnectionstatechange = () => {
      const connectionState = pc.connectionState;
      this.callbacks.onConnection?.(connectionState);
      if (connectionState === 'failed' && this.role === 'offerer') {
        this.#restartIce();
      }
    };

    return pc;
  }

  async #restartIce() {
    if (!this.pc) return;
    try {
      const offer = await this.pc.createOffer({ iceRestart: true });
      await this.pc.setLocalDescription(offer);
      this.socket.emit('rtc:offer', { sdp: this.pc.localDescription });
    } catch {
      // sem recuperação possível agora; o host pode recarregar a página
    }
  }

  #pickSenders(transceivers) {
    let videoCount = 0;
    for (const transceiver of transceivers) {
      const kind = transceiver.receiver?.track?.kind;
      if (kind === 'audio') this.senders.audio = transceiver.sender;
      if (kind === 'video') {
        if (videoCount === 0) this.senders.video = transceiver.sender;
        else if (videoCount === 1) this.senders.camera = transceiver.sender;
        videoCount += 1;
      }
    }
  }

  async startOffer() {
    this.closePeer();
    this.role = 'offerer';

    const pc = this.createPeerConnection();
    const audio = pc.addTransceiver('audio', { direction: 'sendrecv' });
    const video = pc.addTransceiver('video', { direction: 'sendrecv' });
    const camera = pc.addTransceiver('video', { direction: 'sendrecv' });
    this.senders.audio = audio.sender;
    this.senders.video = video.sender;
    this.senders.camera = camera.sender;

    await this.applyTracks();

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.applyVideoQuality();
    this.socket.emit('rtc:offer', { sdp: pc.localDescription });
  }

  async handleOffer(sdp) {
    this.closePeer();
    this.role = 'answerer';

    const pc = this.createPeerConnection();
    await pc.setRemoteDescription(sdp);

    for (const transceiver of pc.getTransceivers()) {
      transceiver.direction = 'sendrecv';
    }
    this.#pickSenders(pc.getTransceivers());

    await this.applyTracks();

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.applyVideoQuality();
    this.socket.emit('rtc:answer', { sdp: pc.localDescription });
    await this.flushIce();
  }

  async handleAnswer(sdp) {
    if (!this.pc || this.pc.signalingState !== 'have-local-offer') return;
    await this.pc.setRemoteDescription(sdp);
    await this.applyVideoQuality();
    await this.flushIce();
  }

  async handleIce(candidate) {
    if (!candidate) return;
    if (!this.pc || !this.pc.remoteDescription) {
      this.pendingIce.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      // candidato obsoleto após renegociação
    }
  }

  async flushIce() {
    if (!this.pc?.remoteDescription) return;
    const pending = this.pendingIce.splice(0);
    for (const candidate of pending) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {
        // candidato obsoleto
      }
    }
  }

  videoTrackForSend() {
    if (this.screenTrack) return this.screenTrack;
    return this.camEnabled ? this.camTrack : null;
  }

  async applyTracks() {
    if (this.senders.audio) {
      try {
        await this.senders.audio.replaceTrack(this.outgoingAudio.getTrack(
          this.micEnabled ? this.micTrack : null,
          this.screenTrack ? this.screenAudioTrack : null,
        ));
      } catch {
        // transceptor ainda não pronto
      }
    }
    if (this.senders.video) {
      try {
        await this.senders.video.replaceTrack(this.videoTrackForSend());
      } catch {
        // transceptor ainda não pronto
      }
    }
    if (this.senders.camera) {
      try {
        await this.senders.camera.replaceTrack(
          this.screenTrack && this.camEnabled ? this.camTrack : null,
        );
      } catch {
        // transceptor ainda não pronto
      }
    }
    await this.applyVideoQuality();
  }

  async applyVideoQuality() {
    const mainKind = this.screenTrack ? 'screen' : 'camera';
    const tasks = [
      [this.senders.video, bitrateFor(this.qualitySettings[mainKind], mainKind)],
      [this.senders.camera, bitrateFor(this.qualitySettings.camera, 'camera')],
    ];
    for (const [sender, bitrate] of tasks) {
      try {
        await setSenderBitrate(sender, bitrate);
      } catch {
        // Alguns navegadores/encoders não aceitam bitrate manual.
      }
    }
  }

  async setQuality(kind, profileId, customOptions) {
    if (kind !== 'camera' && kind !== 'screen') {
      throw new RangeError('Tipo de transmissão desconhecido.');
    }
    const options = profileId === 'custom'
      ? resolveQuality(customOptions)
      : getProfile(profileId);
    const track = kind === 'camera' ? this.camTrack : this.screenTrack;
    if (track && track.readyState !== 'ended' && typeof track.applyConstraints === 'function') {
      await track.applyConstraints(captureConstraints(options));
    }
    this.quality[kind] = profileId;
    this.qualitySettings[kind] = options;
    await this.applyVideoQuality();
  }

  emitLocalStream() {
    const tracks = [];
    if (this.micTrack) tracks.push(this.micTrack);
    const video = this.videoTrackForSend();
    if (video) tracks.push(video);
    this.callbacks.onLocalStream?.(tracks.length ? new MediaStream(tracks) : null);
    const cameraPreview = this.screenTrack && this.camEnabled && this.camTrack
      ? new MediaStream([this.camTrack])
      : null;
    this.callbacks.onLocalCameraStream?.(cameraPreview);
  }

  emitState() {
    if (!this.socket?.connected) return;
    this.socket.emit('media:state', this.mediaState);
  }

  notifyMediaChange() {
    this.emitLocalStream();
    this.callbacks.onMediaChange?.(this.mediaState);
    this.emitState();
  }

  async toggleMic() {
    try {
      if (!this.micTrack || this.micTrack.readyState === 'ended') {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        this.micTrack = stream.getAudioTracks()[0] || null;
        this.micTrack?.addEventListener('ended', () => {
          this.micEnabled = false;
          this.applyTracks().catch(() => {});
          this.notifyMediaChange();
        });
        this.micEnabled = true;
      } else {
        this.micEnabled = !this.micEnabled;
        this.micTrack.enabled = this.micEnabled;
      }

      await this.applyTracks();
      this.notifyMediaChange();
      return this.mediaState;
    } catch (error) {
      throw this.#friendlyError(error, 'microfone');
    }
  }

  async toggleCam() {
    try {
      if (!this.camTrack) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: captureConstraints(this.qualitySettings.camera),
        });
        this.camTrack = stream.getVideoTracks()[0] || null;
        this.camTrack?.addEventListener('ended', () => {
          this.camEnabled = false;
          this.applyTracks().catch(() => {});
          this.notifyMediaChange();
        });
        this.camEnabled = true;
      } else {
        this.camEnabled = !this.camEnabled;
        this.camTrack.enabled = this.camEnabled;
      }

      await this.applyTracks();
      this.notifyMediaChange();
      return this.mediaState;
    } catch (error) {
      throw this.#friendlyError(error, 'câmera');
    }
  }

  async startScreen({ includeAudio = true } = {}) {
    if (this.screenTrack) return this.mediaState;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Seu navegador não suporta compartilhar tela.');
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: captureConstraints(this.qualitySettings.screen),
        audio: Boolean(includeAudio),
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
      });
    } catch (error) {
      if (error?.name === 'NotAllowedError') {
        throw new Error('Compartilhamento de tela cancelado.');
      }
      throw this.#friendlyError(error, 'tela');
    }

    this.screenTrack = stream.getVideoTracks()[0] || null;
    this.screenAudioTrack = includeAudio ? stream.getAudioTracks()[0] || null : null;
    this.screenAudioTrack?.addEventListener('ended', () => {
      if (!this.screenAudioTrack || this.screenAudioTrack.readyState !== 'ended') return;
      this.screenAudioTrack = null;
      this.applyTracks().catch(() => {});
      this.notifyMediaChange();
    });
    this.screenTrack?.addEventListener('ended', () => {
      this.stopScreen().catch(() => {});
    });

    await this.applyTracks();
    this.notifyMediaChange();
    if (includeAudio && !this.screenAudioTrack) {
      this.callbacks.onError?.('A tela foi compartilhada sem som: o navegador não disponibilizou áudio para essa fonte. Tente compartilhar uma aba com áudio.');
    }
    return this.mediaState;
  }

  async stopScreen() {
    const screenAudio = this.screenAudioTrack;
    this.screenAudioTrack = null;
    try { screenAudio?.stop(); } catch {}
    if (this.screenTrack) {
      const track = this.screenTrack;
      this.screenTrack = null;
      try {
        track.stop();
      } catch {
        // já encerrado
      }
    }

    await this.applyTracks();
    this.notifyMediaChange();
    return this.mediaState;
  }

  closePeer() {
    this.outgoingAudio.release();
    this.pendingIce = [];
    this.senders = { audio: null, video: null, camera: null };
    this.role = 'idle';

    if (this.pc) {
      const pc = this.pc;
      this.pc = null;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        // já fechado
      }
    }

    this.remoteStream = emptyRemoteStream();
    this.callbacks.onRemoteStream?.(null);
    this.callbacks.onRemoteCameraStream?.(null);
  }

  destroy() {
    this.closePeer();

    for (const track of [this.micTrack, this.camTrack, this.screenTrack, this.screenAudioTrack]) {
      try {
        track?.stop();
      } catch {
        // já encerrado
      }
    }

    this.micTrack = null;
    this.camTrack = null;
    this.screenTrack = null;
    this.screenAudioTrack = null;
    this.micEnabled = false;
    this.camEnabled = false;

    this.callbacks.onLocalStream?.(null);
    this.callbacks.onLocalCameraStream?.(null);
    this.callbacks.onMediaChange?.(this.mediaState);
  }

  #friendlyError(error, what) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      return new Error(`Permissão de ${what} negada.`);
    }
    if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
      return new Error(`Nenhum dispositivo de ${what} encontrado.`);
    }
    if (error?.name === 'NotReadableError') {
      return new Error(`O ${what} está em uso por outro aplicativo.`);
    }
    return new Error(`Não foi possível ativar ${what}.`);
  }
}