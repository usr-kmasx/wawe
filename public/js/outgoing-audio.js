/**
 * Mantém microfone e áudio da tela independentes e, quando ambos existem,
 * mistura somente para envio. Nunca reproduz a mistura no próprio computador.
 */
export class OutgoingAudio {
  constructor({ onMixUnavailable = () => {} } = {}) {
    this.onMixUnavailable = onMixUnavailable;
    this.context = null;
    this.sources = [];
    this.micTrack = null;
    this.screenTrack = null;
    this.outputTrack = null;
  }

  getTrack(micTrack, screenTrack) {
    const mic = micTrack?.readyState === 'ended' ? null : micTrack || null;
    const screen = screenTrack?.readyState === 'ended' ? null : screenTrack || null;
    if (!mic || !screen) {
      this.release();
      return mic || screen;
    }

    if (this.outputTrack && this.micTrack === mic && this.screenTrack === screen) {
      return this.outputTrack;
    }

    this.release();
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) {
      this.onMixUnavailable();
      return screen; // Nunca perde o áudio compartilhado se não puder misturar.
    }
    try {
      const context = new Context();
      this.context = context;
      const destination = context.createMediaStreamDestination();
      for (const track of [mic, screen]) {
        const source = context.createMediaStreamSource(new MediaStream([track]));
        source.connect(destination);
        this.sources.push(source);
      }
      const output = destination.stream.getAudioTracks()[0];
      if (!output) throw new Error('Mistura sem trilha de áudio.');
      this.micTrack = mic;
      this.screenTrack = screen;
      this.outputTrack = output;
      context.resume?.().catch?.(() => {});
      return output;
    } catch {
      this.release();
      this.onMixUnavailable();
      return screen;
    }
  }

  release() {
    for (const source of this.sources) {
      try { source.disconnect(); } catch {}
    }
    this.sources = [];
    if (this.context) {
      try { this.context.close()?.catch?.(() => {}); } catch {}
    }
    this.context = null;
    this.micTrack = null;
    this.screenTrack = null;
    this.outputTrack = null;
  }
}
