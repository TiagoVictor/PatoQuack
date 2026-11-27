// Sessão de voz em malha P2P: uma RTCPeerConnection por participante remoto.
//
// Regra anti-"glare": quem ENTRA na sala chama connectTo() e manda as offers.
// Quem já estava só responde (handleOffer). Assim os dois lados nunca mandam offer ao mesmo tempo.
//
// Para migrar para um SFU (ex.: LiveKit), crie outra classe com a mesma "interface"
// (connectTo, handleOffer/Answer/IceCandidate, removePeer, setMuted, close e os mesmos eventos)
// e troque a instância em app.js. A UI não precisa saber qual topologia está em uso.
//
// Vídeo (transmissão de tela/câmera): toda conexão nasce com um transceiver de vídeo vazio,
// em sendrecv. Começar ou parar de transmitir é só sender.replaceTrack(track | null), sem
// renegociar. Quem transmite aplica o track atual em toda conexão nova (setVideoTrack).

export class MeshVoiceSession {
  /**
   * @param {{
   *   signaling: import('./signaling.js').VoiceSignaling,
   *   localStream: MediaStream,
   *   iceServers: RTCIceServer[],
   *   onPeerState?: (id: string, state: RTCPeerConnectionState) => void,
   *   onRemoteStream?: (id: string, stream: MediaStream) => void,
   *   onRemoteVideo?: (id: string, track: MediaStreamTrack) => void,
   *   videoMaxBitrate?: number,
   *   preferredVideoCodec?: string | null,
   *   onPeerFailed?: (id: string) => void,
   *   onError?: (id: string, error: unknown) => void,
   * }} options
   */
  constructor({ signaling, localStream, iceServers, onPeerState, onRemoteStream, onRemoteVideo, onPeerFailed, onError, videoMaxBitrate, preferredVideoCodec }) {
    this.signaling = signaling;
    this.localStream = localStream;
    this.iceServers = iceServers;
    this.videoMaxBitrate = videoMaxBitrate ?? 0;
    /** Codec de vídeo a pôr em primeiro na negociação (ex.: 'video/H264'), ou null = padrão. */
    this.preferredVideoCodec = preferredVideoCodec ?? null;

    /** Track de vídeo que estamos transmitindo (ou null). @type {MediaStreamTrack | null} */
    this.videoTrack = null;
    /**
     * Quem está assistindo nossa transmissão: só essas conexões recebem (e codificam) vídeo.
     * Fica fora dos peers porque o aviso pode chegar antes de a conexão existir.
     * @type {Set<string>}
     */
    this.videoViewers = new Set();
    this.events = {
      onPeerState: onPeerState ?? (() => {}),
      onRemoteStream: onRemoteStream ?? (() => {}),
      onRemoteVideo: onRemoteVideo ?? (() => {}),
      onPeerFailed: onPeerFailed ?? (() => {}),
      onError: onError ?? ((id, err) => console.error(`[mesh] ${id}`, err)),
    };

    /** @type {Map<string, Peer>} */
    this.peers = new Map();

    // Candidates que chegam antes de existir a RTCPeerConnection daquele peer.
    /** @type {Map<string, RTCIceCandidateInit[]>} */
    this.earlyCandidates = new Map();

    this.closed = false;
  }

  /** Chamado por quem acabou de entrar: manda offer para cada um que já estava na sala. */
  async connectTo(peerIds) {
    await Promise.all(peerIds.map((id) => this.#startOffer(id)));
  }

  async handleOffer(fromId, offer) {
    await this.#guard(fromId, async () => {
      let peer = this.peers.get(fromId);

      // Não deveria acontecer com a regra "quem entra oferece", mas se houver colisão
      // descartamos nossa conexão e seguimos como quem responde.
      if (peer && peer.pc.signalingState === 'have-local-offer') {
        console.warn(`[mesh] colisão de offers com ${fromId}; recriando como respondedor`);
        this.removePeer(fromId);
        peer = undefined;
      }

      // Uma offer para um peer existente é renegociação (ex.: ICE restart) — reaproveitamos a conexão.
      peer ??= this.#createPeer(fromId, { initiator: false });

      await peer.pc.setRemoteDescription(offer);
      this.#addLocalTracks(peer); // depois da remote description, para casar com o m-line da offer
      await this.#flushCandidates(peer);

      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      await this.signaling.sendAnswer(fromId, peer.pc.localDescription);
      await this.#applyVideo(peer); // depois da negociação os encodings existem (para o bitrate)
    });
  }

  async handleAnswer(fromId, answer) {
    await this.#guard(fromId, async () => {
      const peer = this.peers.get(fromId);
      if (!peer || peer.pc.signalingState !== 'have-local-offer') {
        console.warn(`[mesh] answer inesperada de ${fromId}; ignorando`);
        return;
      }
      await peer.pc.setRemoteDescription(answer);
      await this.#flushCandidates(peer);
      await this.#applyVideo(peer);
    });
  }

  async handleIceCandidate(fromId, candidate) {
    await this.#guard(fromId, async () => {
      const peer = this.peers.get(fromId);

      if (!peer) {
        // Ainda não temos conexão com esse peer: guarda para depois.
        const queue = this.earlyCandidates.get(fromId) ?? [];
        queue.push(candidate);
        this.earlyCandidates.set(fromId, queue);
        return;
      }

      if (!peer.pc.remoteDescription) {
        // addIceCandidate falha sem remoteDescription; aplicamos em #flushCandidates.
        peer.pendingCandidates.push(candidate);
        return;
      }

      await peer.pc.addIceCandidate(candidate);
    });
  }

  /**
   * Começa (track) ou para (null) de transmitir vídeo em todas as conexões, sem renegociar.
   * Conexões criadas depois recebem o mesmo track.
   */
  async setVideoTrack(track) {
    this.videoTrack = track;
    await Promise.all([...this.peers.values()].map((peer) => this.#guard(peer.id, () => this.#applyVideo(peer))));
  }

  /**
   * Liga/desliga o envio de vídeo para uma pessoa (ela começou/parou de assistir), sem
   * renegociar: desligado = replaceTrack(null), nada é codificado nem enviado para ela.
   * @param {string} id
   * @param {boolean} enabled
   */
  async setPeerVideoEnabled(id, enabled) {
    if (enabled) this.videoViewers.add(id);
    else this.videoViewers.delete(id);
    const peer = this.peers.get(id);
    if (peer) await this.#guard(id, () => this.#applyVideo(peer));
  }

  /** Esquece quem assistia (nova transmissão: cada pessoa escolhe assistir de novo). */
  async clearVideoViewers() {
    this.videoViewers.clear();
    await Promise.all([...this.peers.values()].map((peer) => this.#guard(peer.id, () => this.#applyVideo(peer))));
  }

  /**
   * Muda o limite de envio de vídeo (bps) em todas as conexões, sem renegociar.
   * Conexões criadas depois usam o novo valor.
   * @param {number} bps
   */
  async setVideoMaxBitrate(bps) {
    this.videoMaxBitrate = bps;
    await Promise.all([...this.peers.values()].map((peer) => this.#guard(peer.id, () => this.#applyVideo(peer))));
  }

  /**
   * Amostra de estatísticas de cada conexão (contadores acumulados; quem chama calcula taxas a
   * partir de duas amostras). Campos ausentes no navegador ficam undefined.
   * @returns {Promise<PeerStats[]>}
   */
  async collectStats() {
    const peers = [...this.peers.values()].filter((p) => p.pc.connectionState !== 'closed');
    return Promise.all(peers.map(async (peer) => {
      const sample = { id: peer.id, timestamp: performance.now(), out: null, in: null, bytesSent: 0, bytesReceived: 0 };
      let report;
      try {
        report = await peer.pc.getStats();
      } catch {
        return sample;
      }
      const codecOf = (s) => report.get(s.codecId)?.mimeType?.replace(/^video\//, '');
      for (const s of report.values()) {
        if (s.type === 'transport') {
          sample.bytesSent += s.bytesSent ?? 0;
          sample.bytesReceived += s.bytesReceived ?? 0;
        } else if (s.type === 'outbound-rtp' && s.kind === 'video') {
          sample.out = {
            bytes: s.bytesSent ?? 0,
            frames: s.framesEncoded ?? 0,
            width: s.frameWidth, height: s.frameHeight, fps: s.framesPerSecond,
            limitation: s.qualityLimitationReason,
            encoder: s.encoderImplementation,
            codec: codecOf(s),
          };
        } else if (s.type === 'inbound-rtp' && s.kind === 'video') {
          sample.in = {
            bytes: s.bytesReceived ?? 0,
            frames: s.framesDecoded ?? 0,
            width: s.frameWidth, height: s.frameHeight, fps: s.framesPerSecond,
            dropped: s.framesDropped ?? 0,
            decodeTime: s.totalDecodeTime ?? 0,
            decoder: s.decoderImplementation,
            codec: codecOf(s),
          };
        }
      }
      return sample;
    }));
  }

  /**
   * Troca o microfone (outro dispositivo) em todas as conexões, sem renegociar.
   * Conexões criadas depois já nascem com o stream novo.
   * @param {MediaStream} stream
   */
  async replaceAudioTrack(stream) {
    this.localStream = stream;
    const [track] = stream.getAudioTracks();
    await Promise.all([...this.peers.values()].map((peer) => this.#guard(peer.id, async () => {
      if (peer.audioSender && peer.pc.connectionState !== 'closed') await peer.audioSender.replaceTrack(track ?? null);
    })));
  }

  removePeer(id) {
    const peer = this.peers.get(id);
    this.earlyCandidates.delete(id);
    if (!peer) return;

    this.peers.delete(id);
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
  }

  close() {
    this.closed = true;
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.earlyCandidates.clear();
  }

  // ---- internos ---------------------------------------------------------

  async #startOffer(id) {
    await this.#guard(id, async () => {
      if (this.peers.has(id)) return;
      const peer = this.#createPeer(id, { initiator: true });
      this.#addLocalTracks(peer);
      await this.#sendOffer(peer);
    });
  }

  async #sendOffer(peer, { iceRestart = false } = {}) {
    const offer = await peer.pc.createOffer({ iceRestart });
    await peer.pc.setLocalDescription(offer);
    await this.signaling.sendOffer(peer.id, peer.pc.localDescription);
  }

  #createPeer(id, { initiator }) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });

    /** @type {Peer} */
    const peer = {
      id,
      pc,
      initiator,
      tracksAdded: false,
      audioSender: null,
      videoSender: null,
      iceRestarted: false,
      pendingCandidates: this.earlyCandidates.get(id) ?? [],
    };
    this.earlyCandidates.delete(id);
    this.peers.set(id, peer);

    pc.onicecandidate = (event) => {
      // candidate null = fim da coleta; não precisa ser repassado.
      if (!event.candidate) return;
      this.signaling
        .sendIceCandidate(id, event.candidate.toJSON())
        .catch((err) => this.events.onError(id, err));
    };

    pc.ontrack = (event) => {
      if (event.track.kind === 'video') {
        // Fica "mudo" (sem frames) até o outro lado chamar replaceTrack com um track de verdade.
        this.events.onRemoteVideo(id, event.track);
        return;
      }
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.events.onRemoteStream(id, stream);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      this.events.onPeerState(id, state);

      if (state === 'connected') {
        peer.iceRestarted = false;
      } else if (state === 'failed') {
        // Tenta um ICE restart uma vez (só quem iniciou, para manter a regra anti-glare).
        if (peer.initiator && !peer.iceRestarted && !this.closed) {
          peer.iceRestarted = true;
          this.#guard(id, () => this.#sendOffer(peer, { iceRestart: true }));
        } else {
          this.events.onPeerFailed(id);
        }
      }
    };

    this.events.onPeerState(id, pc.connectionState);
    return peer;
  }

  #addLocalTracks(peer) {
    if (peer.tracksAdded) return;
    for (const track of this.localStream.getAudioTracks()) {
      // Guardamos o sender para trocar o microfone depois (replaceAudioTrack).
      peer.audioSender = peer.pc.addTrack(track, this.localStream);
    }

    if (peer.initiator) {
      // Vem depois do áudio: a offer fica com m-line de áudio e depois a de vídeo.
      const transceiver = peer.pc.addTransceiver('video', { direction: 'sendrecv' });
      this.#preferCodec(transceiver);
      peer.videoSender = transceiver.sender;
    } else {
      // Quem responde reaproveita o transceiver que a offer criou. Ele nasce 'recvonly';
      // passamos para 'sendrecv' antes do createAnswer para também poder transmitir.
      const transceiver = peer.pc.getTransceivers()
        .find((t) => t.receiver.track?.kind === 'video' && !t.stopped);
      if (transceiver) {
        transceiver.direction = 'sendrecv';
        this.#preferCodec(transceiver);
        peer.videoSender = transceiver.sender;
      } else {
        console.warn(`[mesh] offer de ${peer.id} sem vídeo; transmissão indisponível com esse peer`);
      }
    }

    // O track de vídeo atual (se estamos transmitindo) é aplicado por #applyVideo assim que a
    // negociação termina (handleOffer/handleAnswer), então quem chega recebe o vídeo desde o início.
    peer.tracksAdded = true;
  }

  /** Aplica o track de vídeo atual (ou null) ao sender e, se der, limita o bitrate. */
  async #applyVideo(peer) {
    const sender = peer.videoSender;
    if (!sender || peer.pc.connectionState === 'closed') return;

    // Só quem está assistindo recebe o vídeo; para os demais o sender fica vazio.
    const track = this.videoViewers.has(peer.id) ? this.videoTrack : null;
    if (sender.track !== track) {
      await sender.replaceTrack(track);
    }

    if (!track) return;
    // Sem banda/CPU suficiente, o que sacrificar: tela (texto) mantém a resolução e cai o FPS;
    // câmera (movimento) mantém o FPS e cai a resolução.
    const preference = track.contentHint === 'detail' || track.contentHint === 'text'
      ? 'maintain-resolution' : 'maintain-framerate';
    const bitrate = this.videoMaxBitrate;
    try {
      const params = sender.getParameters();
      // Antes da negociação terminar os encodings podem estar vazios; tentamos de novo depois.
      if (!params.encodings?.length) return;
      const bitrateOk = !bitrate || params.encodings[0].maxBitrate === bitrate;
      if (bitrateOk && params.degradationPreference === preference) return;
      if (bitrate) params.encodings[0].maxBitrate = bitrate;
      params.degradationPreference = preference;
      try {
        await sender.setParameters(params);
      } catch {
        // Navegador sem degradationPreference: aplica só o limite de bitrate.
        if (!bitrate) return;
        const retry = sender.getParameters();
        if (!retry.encodings?.length) return;
        retry.encodings[0].maxBitrate = bitrate;
        await sender.setParameters(retry);
      }
    } catch (err) {
      console.warn(`[mesh] não foi possível ajustar o envio de vídeo para ${peer.id}`, err);
    }
  }

  /** Põe o codec preferido em primeiro (mantém os demais como alternativa). Antes da offer/answer. */
  #preferCodec(transceiver) {
    const mime = this.preferredVideoCodec?.toLowerCase();
    if (!mime || typeof transceiver.setCodecPreferences !== 'function') return;
    try {
      const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs ?? [];
      const first = codecs.filter((c) => c.mimeType.toLowerCase() === mime);
      if (!first.length) return;
      transceiver.setCodecPreferences([...first, ...codecs.filter((c) => c.mimeType.toLowerCase() !== mime)]);
    } catch (err) {
      console.warn('[mesh] não foi possível preferir o codec', this.preferredVideoCodec, err);
    }
  }

  async #flushCandidates(peer) {
    const queued = peer.pendingCandidates.splice(0);
    for (const candidate of queued) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn(`[mesh] candidate descartado de ${peer.id}`, err);
      }
    }
  }

  async #guard(id, fn) {
    if (this.closed) return;
    try {
      await fn();
    } catch (err) {
      if (!this.closed) this.events.onError(id, err);
    }
  }
}

/**
 * @typedef {{
 *   id: string,
 *   pc: RTCPeerConnection,
 *   initiator: boolean,
 *   tracksAdded: boolean,
 *   audioSender: RTCRtpSender | null,
 *   videoSender: RTCRtpSender | null,
 *   iceRestarted: boolean,
 *   pendingCandidates: RTCIceCandidateInit[],
 * }} Peer
 */

/**
 * @typedef {{
 *   id: string,
 *   timestamp: number,
 *   bytesSent: number,
 *   bytesReceived: number,
 *   out: { bytes: number, frames: number, width?: number, height?: number, fps?: number,
 *          limitation?: string, encoder?: string, codec?: string } | null,
 *   in: { bytes: number, frames: number, width?: number, height?: number, fps?: number,
 *         dropped: number, decodeTime: number, decoder?: string, codec?: string } | null,
 * }} PeerStats
 */
