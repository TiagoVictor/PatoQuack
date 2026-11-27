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
   *   onPeerFailed?: (id: string) => void,
   *   onError?: (id: string, error: unknown) => void,
   * }} options
   */
  constructor({ signaling, localStream, iceServers, onPeerState, onRemoteStream, onRemoteVideo, onPeerFailed, onError, videoMaxBitrate }) {
    this.signaling = signaling;
    this.localStream = localStream;
    this.iceServers = iceServers;
    this.videoMaxBitrate = videoMaxBitrate ?? 0;

    /** Track de vídeo que estamos transmitindo (ou null). @type {MediaStreamTrack | null} */
    this.videoTrack = null;
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
   * Muda o limite de envio de vídeo (bps) em todas as conexões, sem renegociar.
   * Conexões criadas depois usam o novo valor.
   * @param {number} bps
   */
  async setVideoMaxBitrate(bps) {
    this.videoMaxBitrate = bps;
    await Promise.all([...this.peers.values()].map((peer) => this.#guard(peer.id, () => this.#applyVideo(peer))));
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
      peer.videoSender = peer.pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
    } else {
      // Quem responde reaproveita o transceiver que a offer criou. Ele nasce 'recvonly';
      // passamos para 'sendrecv' antes do createAnswer para também poder transmitir.
      const transceiver = peer.pc.getTransceivers()
        .find((t) => t.receiver.track?.kind === 'video' && !t.stopped);
      if (transceiver) {
        transceiver.direction = 'sendrecv';
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

    if (sender.track !== this.videoTrack) {
      await sender.replaceTrack(this.videoTrack);
    }

    if (!this.videoTrack || !this.videoMaxBitrate) return;
    try {
      const params = sender.getParameters();
      // Antes da negociação terminar os encodings podem estar vazios; tentamos de novo depois.
      if (!params.encodings?.length || params.encodings[0].maxBitrate === this.videoMaxBitrate) return;
      params.encodings[0].maxBitrate = this.videoMaxBitrate;
      await sender.setParameters(params);
    } catch (err) {
      console.warn(`[mesh] não foi possível limitar o bitrate para ${peer.id}`, err);
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
