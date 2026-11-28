import { SignalingChannel } from '../signaling/voice.models';

export interface MeshVoiceSessionOptions {
  signaling: SignalingChannel;
  localStream: MediaStream;
  iceServers: RTCIceServer[];
  videoMaxBitrate?: number;
  /** Codec de vídeo a pôr em primeiro na negociação (ex.: 'video/H264'), ou null = padrão. */
  preferredVideoCodec?: string | null;
  onPeerState?: (id: string, state: RTCPeerConnectionState) => void;
  onRemoteStream?: (id: string, stream: MediaStream) => void;
  onRemoteVideo?: (id: string, track: MediaStreamTrack) => void;
  onPeerFailed?: (id: string) => void;
  onError?: (id: string, error: unknown) => void;
}

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  initiator: boolean;
  tracksAdded: boolean;
  audioSender: RTCRtpSender | null;
  videoSender: RTCRtpSender | null;
  iceRestarted: boolean;
  pendingCandidates: RTCIceCandidateInit[];
}

/** Amostra de estatísticas de uma conexão (contadores acumulados; taxas = diferença entre amostras). */
export interface PeerStats {
  id: string;
  timestamp: number;
  bytesSent: number;
  bytesReceived: number;
  out: {
    bytes: number; frames: number; width?: number; height?: number; fps?: number;
    limitation?: string; encoder?: string; codec?: string;
  } | null;
  in: {
    bytes: number; frames: number; width?: number; height?: number; fps?: number;
    dropped: number; decodeTime: number; decoder?: string; codec?: string;
  } | null;
}

/**
 * Sessão de voz em malha P2P: uma RTCPeerConnection por participante remoto.
 *
 * Regra anti-"glare": quem ENTRA na sala chama connectToAsync() e manda as offers. Quem já
 * estava só responde (handleOfferAsync). Assim os dois lados nunca mandam offer ao mesmo tempo.
 *
 * Para migrar para um SFU (ex.: LiveKit), crie outra classe com a mesma interface e troque a
 * instância no VoiceRoomStore. A UI não sabe qual topologia está em uso.
 *
 * Vídeo: toda conexão nasce com um transceiver de vídeo vazio, em sendrecv. Começar ou parar de
 * transmitir é só sender.replaceTrack(track | null), sem renegociar. Só quem avisou que está
 * assistindo (setPeerVideoEnabled) recebe — e só para essas conexões o vídeo é codificado.
 */
export class MeshVoiceSession {
  private readonly peers = new Map<string, Peer>();
  /** Candidates que chegam antes de existir a RTCPeerConnection daquele peer. */
  private readonly earlyCandidates = new Map<string, RTCIceCandidateInit[]>();
  /** Track de vídeo que estamos transmitindo (ou null). */
  private videoTrack: MediaStreamTrack | null = null;
  /** Quem está assistindo nossa transmissão. Fora dos peers: o aviso pode chegar antes da conexão. */
  private readonly videoViewers = new Set<string>();
  private videoMaxBitrate: number;
  private localStream: MediaStream;
  private closed = false;

  constructor(private readonly options: MeshVoiceSessionOptions) {
    this.videoMaxBitrate = options.videoMaxBitrate ?? 0;
    this.localStream = options.localStream;
  }

  /** Chamado por quem acabou de entrar: manda offer para cada um que já estava na sala. */
  async connectToAsync(peerIds: string[]): Promise<void> {
    await Promise.all(peerIds.map((id) => this.startOfferAsync(id)));
  }

  async handleOfferAsync(fromId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    await this.guardAsync(fromId, async () => {
      let peer = this.peers.get(fromId);

      // Não deveria acontecer com a regra "quem entra oferece", mas se houver colisão
      // descartamos nossa conexão e seguimos como quem responde.
      if (peer && peer.pc.signalingState === 'have-local-offer') {
        console.warn(`[mesh] colisão de offers com ${fromId}; recriando como respondedor`);
        this.removePeer(fromId);
        peer = undefined;
      }

      // Uma offer para um peer existente é renegociação (ex.: ICE restart): reaproveita a conexão.
      peer ??= this.createPeer(fromId, false);

      await peer.pc.setRemoteDescription(offer);
      this.addLocalTracks(peer); // depois da remote description, para casar com o m-line da offer
      await this.flushCandidatesAsync(peer);

      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      await this.options.signaling.sendAnswer(fromId, peer.pc.localDescription!);
      await this.applyVideoAsync(peer); // depois da negociação os encodings existem (bitrate)
    });
  }

  async handleAnswerAsync(fromId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    await this.guardAsync(fromId, async () => {
      const peer = this.peers.get(fromId);
      if (!peer || peer.pc.signalingState !== 'have-local-offer') {
        console.warn(`[mesh] answer inesperada de ${fromId}; ignorando`);
        return;
      }
      await peer.pc.setRemoteDescription(answer);
      await this.flushCandidatesAsync(peer);
      await this.applyVideoAsync(peer);
    });
  }

  async handleIceCandidateAsync(fromId: string, candidate: RTCIceCandidateInit): Promise<void> {
    await this.guardAsync(fromId, async () => {
      const peer = this.peers.get(fromId);

      if (!peer) {
        // Ainda não temos conexão com esse peer: guarda para depois.
        const queue = this.earlyCandidates.get(fromId) ?? [];
        queue.push(candidate);
        this.earlyCandidates.set(fromId, queue);
        return;
      }

      if (!peer.pc.remoteDescription) {
        // addIceCandidate falha sem remoteDescription; aplicamos em flushCandidatesAsync.
        peer.pendingCandidates.push(candidate);
        return;
      }

      await peer.pc.addIceCandidate(candidate);
    });
  }

  /** Começa (track) ou para (null) de transmitir vídeo em todas as conexões, sem renegociar. */
  async setVideoTrackAsync(track: MediaStreamTrack | null): Promise<void> {
    this.videoTrack = track;
    await this.applyVideoToAllAsync();
  }

  /** Liga/desliga o envio de vídeo para uma pessoa (começou/parou de assistir), sem renegociar. */
  async setPeerVideoEnabledAsync(id: string, enabled: boolean): Promise<void> {
    if (enabled) this.videoViewers.add(id);
    else this.videoViewers.delete(id);
    const peer = this.peers.get(id);
    if (peer) await this.guardAsync(id, () => this.applyVideoAsync(peer));
  }

  /** Esquece quem assistia (nova transmissão: cada pessoa escolhe assistir de novo). */
  async clearVideoViewersAsync(): Promise<void> {
    this.videoViewers.clear();
    await this.applyVideoToAllAsync();
  }

  /** Muda o limite de envio de vídeo (bps) em todas as conexões, sem renegociar. */
  async setVideoMaxBitrateAsync(bps: number): Promise<void> {
    this.videoMaxBitrate = bps;
    await this.applyVideoToAllAsync();
  }

  /** Troca o microfone (outro dispositivo) em todas as conexões, sem renegociar. */
  async replaceAudioTrackAsync(stream: MediaStream): Promise<void> {
    this.localStream = stream;
    const [track] = stream.getAudioTracks();
    await Promise.all([...this.peers.values()].map((peer) => this.guardAsync(peer.id, async () => {
      if (peer.audioSender && peer.pc.connectionState !== 'closed') await peer.audioSender.replaceTrack(track ?? null);
    })));
  }

  /** Estatísticas de cada conexão (para o painel de diagnóstico). */
  async collectStatsAsync(): Promise<PeerStats[]> {
    const peers = [...this.peers.values()].filter((p) => p.pc.connectionState !== 'closed');
    return Promise.all(peers.map(async (peer) => {
      const sample: PeerStats = { id: peer.id, timestamp: performance.now(), out: null, in: null, bytesSent: 0, bytesReceived: 0 };
      let report: RTCStatsReport;
      try {
        report = await peer.pc.getStats();
      } catch {
        return sample;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const codecOf = (s: any) => (report.get(s.codecId) as { mimeType?: string } | undefined)?.mimeType?.replace(/^video\//, '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      report.forEach((s: any) => {
        if (s.type === 'transport') {
          sample.bytesSent += s.bytesSent ?? 0;
          sample.bytesReceived += s.bytesReceived ?? 0;
        } else if (s.type === 'outbound-rtp' && s.kind === 'video') {
          sample.out = {
            bytes: s.bytesSent ?? 0, frames: s.framesEncoded ?? 0, width: s.frameWidth, height: s.frameHeight,
            fps: s.framesPerSecond, limitation: s.qualityLimitationReason, encoder: s.encoderImplementation, codec: codecOf(s),
          };
        } else if (s.type === 'inbound-rtp' && s.kind === 'video') {
          sample.in = {
            bytes: s.bytesReceived ?? 0, frames: s.framesDecoded ?? 0, width: s.frameWidth, height: s.frameHeight,
            fps: s.framesPerSecond, dropped: s.framesDropped ?? 0, decodeTime: s.totalDecodeTime ?? 0,
            decoder: s.decoderImplementation, codec: codecOf(s),
          };
        }
      });
      return sample;
    }));
  }

  removePeer(id: string): void {
    const peer = this.peers.get(id);
    this.earlyCandidates.delete(id);
    if (!peer) return;

    this.peers.delete(id);
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
  }

  close(): void {
    this.closed = true;
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.earlyCandidates.clear();
  }

  // ---- internos ---------------------------------------------------------

  private async startOfferAsync(id: string): Promise<void> {
    await this.guardAsync(id, async () => {
      if (this.peers.has(id)) return;
      const peer = this.createPeer(id, true);
      this.addLocalTracks(peer);
      await this.sendOfferAsync(peer);
    });
  }

  private async sendOfferAsync(peer: Peer, iceRestart = false): Promise<void> {
    const offer = await peer.pc.createOffer({ iceRestart });
    await peer.pc.setLocalDescription(offer);
    await this.options.signaling.sendOffer(peer.id, peer.pc.localDescription!);
  }

  private createPeer(id: string, initiator: boolean): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.options.iceServers });
    const peer: Peer = {
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
      this.options.signaling
        .sendIceCandidate(id, event.candidate.toJSON())
        .catch((error) => this.reportError(id, error));
    };

    pc.ontrack = (event) => {
      if (event.track.kind === 'video') {
        // Fica "mudo" (sem frames) até o outro lado chamar replaceTrack com um track de verdade.
        this.options.onRemoteVideo?.(id, event.track);
        return;
      }
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.options.onRemoteStream?.(id, stream);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      this.options.onPeerState?.(id, state);

      if (state === 'connected') {
        peer.iceRestarted = false;
      } else if (state === 'failed') {
        // Tenta um ICE restart uma vez (só quem iniciou, para manter a regra anti-glare).
        if (peer.initiator && !peer.iceRestarted && !this.closed) {
          peer.iceRestarted = true;
          void this.guardAsync(id, () => this.sendOfferAsync(peer, true));
        } else {
          this.options.onPeerFailed?.(id);
        }
      }
    };

    this.options.onPeerState?.(id, pc.connectionState);
    return peer;
  }

  private addLocalTracks(peer: Peer): void {
    if (peer.tracksAdded) return;
    const localStream = this.localStream;
    for (const track of localStream.getAudioTracks()) {
      // Guardamos o sender para trocar o microfone depois (replaceAudioTrackAsync).
      peer.audioSender = peer.pc.addTrack(track, localStream);
    }

    if (peer.initiator) {
      // Vem depois do áudio: a offer fica com m-line de áudio e depois a de vídeo.
      const transceiver = peer.pc.addTransceiver('video', { direction: 'sendrecv' });
      this.preferCodec(transceiver);
      peer.videoSender = transceiver.sender;
    } else {
      // Quem responde reaproveita o transceiver que a offer criou. Ele nasce 'recvonly';
      // passamos para 'sendrecv' antes do createAnswer para também poder transmitir.
      const transceiver = peer.pc.getTransceivers()
        .find((t) => t.receiver.track?.kind === 'video' && t.currentDirection !== 'stopped');
      if (transceiver) {
        transceiver.direction = 'sendrecv';
        this.preferCodec(transceiver);
        peer.videoSender = transceiver.sender;
      } else {
        console.warn(`[mesh] offer de ${peer.id} sem vídeo; transmissão indisponível com esse peer`);
      }
    }

    peer.tracksAdded = true;
  }

  private async applyVideoToAllAsync(): Promise<void> {
    await Promise.all([...this.peers.values()].map((peer) => this.guardAsync(peer.id, () => this.applyVideoAsync(peer))));
  }

  /** Aplica o track de vídeo atual a quem assiste (null para os demais) e ajusta o envio. */
  private async applyVideoAsync(peer: Peer): Promise<void> {
    const sender = peer.videoSender;
    if (!sender || peer.pc.connectionState === 'closed') return;

    // Só quem está assistindo recebe o vídeo; para os demais o sender fica vazio.
    const track = this.videoViewers.has(peer.id) ? this.videoTrack : null;
    if (sender.track !== track) {
      await sender.replaceTrack(track);
    }

    if (!track) return;
    // Sem banda/CPU suficiente: tela (texto) mantém a resolução e cai o FPS; câmera (movimento)
    // mantém o FPS e cai a resolução.
    const preference: RTCDegradationPreference = track.contentHint === 'detail' || track.contentHint === 'text'
      ? 'maintain-resolution' : 'maintain-framerate';
    const bitrate = this.videoMaxBitrate;
    try {
      const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: RTCDegradationPreference };
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
    } catch (error) {
      console.warn(`[mesh] não foi possível ajustar o envio de vídeo para ${peer.id}`, error);
    }
  }

  /** Põe o codec preferido em primeiro (mantém os demais como alternativa). Antes da offer/answer. */
  private preferCodec(transceiver: RTCRtpTransceiver): void {
    const mime = this.options.preferredVideoCodec?.toLowerCase();
    if (!mime || typeof transceiver.setCodecPreferences !== 'function') return;
    try {
      const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs ?? [];
      const first = codecs.filter((c) => c.mimeType.toLowerCase() === mime);
      if (!first.length) return;
      transceiver.setCodecPreferences([...first, ...codecs.filter((c) => c.mimeType.toLowerCase() !== mime)]);
    } catch (error) {
      console.warn('[mesh] não foi possível preferir o codec', mime, error);
    }
  }

  private async flushCandidatesAsync(peer: Peer): Promise<void> {
    for (const candidate of peer.pendingCandidates.splice(0)) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch (error) {
        console.warn(`[mesh] candidate descartado de ${peer.id}`, error);
      }
    }
  }

  private async guardAsync(id: string, action: () => Promise<void>): Promise<void> {
    if (this.closed) return;
    try {
      await action();
    } catch (error) {
      if (!this.closed) this.reportError(id, error);
    }
  }

  private reportError(id: string, error: unknown): void {
    if (this.options.onError) this.options.onError(id, error);
    else console.error(`[mesh] ${id}`, error);
  }
}
