import { Injectable, computed, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { AuthStore } from '../../../core/auth/auth.store';
import { VOICE_CONFIG } from '../../../core/config/voice.config';
import { canPickSpeaker, isMissingDevice, saveDevice, savedDevice, withDevice } from '../../../core/media/devices';
import { readBool, readNumber, writePref } from '../../../core/media/preferences';
import {
  CodecChoice, StreamKind, VideoQuality, constraintsFor, loadQuality, loadUploadBudget, normalizeQuality,
  perViewerBitrate, pickVideoCodec, qualityLabel, saveQuality, saveUploadBudget,
} from '../../../core/media/quality';
import { MeshVoiceSession, PeerStats } from '../../../core/rtc/mesh-voice-session';
import { SpeakingDetector } from '../../../core/rtc/speaking-detector';
import { VoiceSignalingService } from '../../../core/signaling/voice-signaling.service';
import { errorMessage, errorName } from '../../../core/util/error-message';
import { StatusLevel } from '../../../shared/ui';
import {
  ChannelRef, PreviewRequest, RoomParticipant, StatusEntry, Streamer, VoiceEvent, VoicePhase,
} from './voice-room.models';

export const LOCAL_ID = 'local';
const MAX_LOG_ENTRIES = 50;
const STREAM_LABELS: Record<StreamKind, string> = { screen: 'a tela', camera: 'a câmera' };

/**
 * Estado e orquestração da voz: microfone, sinalização, malha WebRTC, participantes,
 * transmissão (com assistir sob demanda) e dispositivos no canal atual. Os componentes só leem
 * os signals e chamam os métodos *Async.
 */
@Injectable({ providedIn: 'root' })
export class VoiceRoomStore {
  private readonly config = inject(VOICE_CONFIG);
  private readonly signaling = inject(VoiceSignalingService);
  private readonly auth = inject(AuthStore);

  // ---- estado da chamada -------------------------------------------------
  private readonly _phase = signal<VoicePhase>('idle');
  private readonly _channel = signal<ChannelRef | null>(null);
  /** Último canal que o servidor avisou que foi excluído (para a lista de canais se atualizar). */
  private readonly _deletedChannelId = signal<string | null>(null);
  /** O servidor nos tirou da chamada (motivo), para a tela reagir. */
  private readonly _kicked = signal<{ reason: string; at: number } | null>(null);
  private readonly _name = signal('');
  private readonly _muted = signal(false);
  private readonly _deafened = signal(false);
  private mutedBeforeDeafen = false;
  private readonly _joinedAt = signal<number | null>(null);
  private readonly _participants = signal<ReadonlyMap<string, RoomParticipant>>(new Map());
  private readonly _status = signal<StatusEntry | null>(null);
  private readonly _log = signal<readonly StatusEntry[]>([]);
  private logSeq = 0;

  // ---- transmissão -----------------------------------------------------
  private readonly _streamer = signal<Streamer | null>(null);
  private readonly _localVideo = signal<MediaStream | null>(null);
  private readonly _localVideoKind = signal<StreamKind | null>(null);
  private readonly _startingStream = signal(false);
  private readonly _remoteVideo = signal<ReadonlyMap<string, MediaStreamTrack>>(new Map());
  /** Quem assiste: estou recebendo a transmissão de outra pessoa? (só chega vídeo se sim) */
  private readonly _watching = signal(false);
  /** Quem transmite: connectionIds de quem está assistindo (só eles recebem vídeo). */
  private readonly _viewers = signal<ReadonlySet<string>>(new Set());
  private readonly _preview = signal<PreviewRequest | null>(null);
  private previewResolve: ((media: MediaStream | null) => void) | null = null;

  // ---- preferências ------------------------------------------------------
  private readonly _autoWatch = signal(readBool('pq.autoWatch', false));
  private readonly _quality = signal<Record<StreamKind, VideoQuality>>({ camera: loadQuality('camera'), screen: loadQuality('screen') });
  private readonly _uploadBudget = signal(loadUploadBudget());
  private readonly _alwaysPreview = signal<Record<StreamKind, boolean>>({
    camera: readBool('pq.preview.camera', true),
    screen: readBool('pq.preview.screen', true),
  });
  private readonly _cameraId = signal<string | null>(savedDevice('videoinput'));
  private readonly _micId = signal<string | null>(savedDevice('audioinput'));
  private readonly _speakerId = signal<string | null>(savedDevice('audiooutput'));
  private readonly _outputVolume = signal(readNumber('pq.volume', 1, 0, 1));

  private localStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private speaking: SpeakingDetector | null = null;
  private session: MeshVoiceSession | null = null;
  /** Codec de vídeo preferido (H.264 se houver codificador por hardware); decidido uma vez. */
  private readonly codecChoice: Promise<CodecChoice> = pickVideoCodec();
  private readonly _codec = signal<CodecChoice | null>(null);

  /** Entradas, saídas, transmissões e chat — para o chat e outras telas. */
  readonly events = new Subject<VoiceEvent>();

  readonly phase = this._phase.asReadonly();
  readonly channel = this._channel.asReadonly();
  readonly deletedChannelId = this._deletedChannelId.asReadonly();
  readonly kicked = this._kicked.asReadonly();
  readonly muted = this._muted.asReadonly();
  readonly deafened = this._deafened.asReadonly();
  readonly joinedAt = this._joinedAt.asReadonly();
  readonly streamer = this._streamer.asReadonly();
  readonly startingStream = this._startingStream.asReadonly();
  readonly localVideoKind = this._localVideoKind.asReadonly();
  readonly watching = this._watching.asReadonly();
  readonly preview = this._preview.asReadonly();
  readonly autoWatch = this._autoWatch.asReadonly();
  readonly quality = this._quality.asReadonly();
  readonly uploadBudget = this._uploadBudget.asReadonly();
  readonly alwaysPreview = this._alwaysPreview.asReadonly();
  readonly cameraId = this._cameraId.asReadonly();
  readonly speakerId = this._speakerId.asReadonly();
  readonly outputVolume = this._outputVolume.asReadonly();
  readonly codec = this._codec.asReadonly();
  readonly status = this._status.asReadonly();
  readonly log = this._log.asReadonly();
  readonly canPickSpeaker = canPickSpeaker;

  readonly inRoom = computed(() => this._phase() === 'in-room');
  readonly participants = computed(() => [...this._participants().values()]);
  readonly viewerCount = computed(() => this._viewers().size);
  readonly isStreaming = computed(() => this._localVideo() !== null);
  readonly isLocalStreamer = computed(() => {
    const streamer = this._streamer();
    return streamer !== null && streamer.id === this.signaling.connectionId;
  });
  /** Outra pessoa transmite: não podemos começar. */
  readonly streamBlockedBy = computed(() => {
    const streamer = this._streamer();
    return streamer && !this.isLocalStreamer() ? streamer : null;
  });
  /** Id (na lista de participantes) de quem transmite: "local" quando somos nós. */
  readonly streamerParticipantId = computed(() => {
    const streamer = this._streamer();
    if (!streamer) return null;
    return this.isLocalStreamer() ? LOCAL_ID : streamer.id;
  });
  /**
   * O que o palco mostra da transmissão: nossa prévia, ou o track recebido de quem transmite —
   * só se estivermos assistindo (sem assistir, nenhum vídeo chega).
   */
  readonly streamSource = computed<MediaStream | null>(() => {
    const streamer = this._streamer();
    if (!streamer) return null;
    if (this.isLocalStreamer()) return this._localVideo();
    if (!this._watching()) return null;
    const track = this._remoteVideo().get(streamer.id);
    return track ? new MediaStream([track]) : null;
  });

  constructor() {
    void this.codecChoice.then((choice) => this._codec.set(choice));
    this.registerSignalingHandlers();
    window.addEventListener('pagehide', () => {
      if (this.inRoom()) void this.signaling.stopAsync();
    });
  }

  get connectionId(): string | null {
    return this.signaling.connectionId;
  }

  /** Nome de quem está na chamada pelo connectionId do servidor (ou o nosso). */
  nameOfConnection(connectionId: string): string | null {
    if (connectionId === this.signaling.connectionId) return this._name();
    return this._participants().get(connectionId)?.name ?? null;
  }

  // ---- entrar e sair -----------------------------------------------------

  /** Entra no canal: pede o microfone e conecta. Precisa vir de um clique (Safari/AudioContext). */
  async joinAsync(channel: ChannelRef): Promise<void> {
    const name = this.auth.user()?.name;
    if (!name || this._phase() !== 'idle') return;

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.setStatus('O microfone só funciona em HTTPS ou em http://localhost. Abra a página por um desses endereços.', 'error');
      return;
    }

    // O AudioContext precisa nascer ANTES de qualquer await: o Safari só considera o clique
    // como gesto do usuário de forma síncrona. Depois do await, resume() pode ficar travado.
    const audioContext = new AudioContext();
    audioContext.resume().catch(() => {});

    this._phase.set('joining');
    this.setStatus('Pedindo acesso ao microfone…');

    try {
      this.localStream = await this.captureMicAsync();
    } catch (error) {
      this._phase.set('idle');
      audioContext.close().catch(() => {});
      const reason = errorName(error) === 'NotAllowedError'
        ? 'permissão negada. Libere o microfone nas configurações do site.'
        : errorName(error) === 'NotFoundError' ? 'nenhum microfone encontrado.' : errorMessage(error);
      this.setStatus(`Não foi possível usar o microfone: ${reason}`, 'error');
      return;
    }

    this.watchMicEnded(this.localStream);
    this.audioContext = audioContext;
    this.speaking = new SpeakingDetector(audioContext, this.config.speakingThreshold, this.config.speakingHoldMs,
      (id, speaking) => this.patchParticipant(id, { speaking }));

    this._name.set(name);
    this._channel.set(channel);
    this._muted.set(false);
    this._deafened.set(false);
    this._phase.set('in-room');
    this._joinedAt.set(Date.now());

    this.upsertParticipant(LOCAL_ID, { name, muted: false, connection: 'local', isLocal: true });
    this.speaking.watch(LOCAL_ID, this.localStream);

    try {
      this.setStatus('Conectando ao servidor…');
      if (!this.signaling.isConnected) await this.signaling.startAsync();
      await this.enterRoomAsync();
    } catch (error) {
      this.setStatus(`Não foi possível entrar: ${errorMessage(error)}`, 'error');
      await this.leaveAsync(false);
    }
  }

  async leaveAsync(notifyServer = true): Promise<void> {
    const wasInRoom = this.inRoom();
    this._phase.set('idle');
    this.cancelPreview(); // prévia aberta: encerra a captura sem transmitir

    if (notifyServer && this.signaling.isConnected) {
      try { await this.signaling.leaveChannelAsync(); } catch { /* vamos desconectar de qualquer jeito */ }
    }

    await this.resetSessionAsync();
    this.removeParticipant(LOCAL_ID);
    this.speaking?.stop();
    this.speaking = null;
    this.localStream?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    this.localStream = null;
    await this.audioContext?.close().catch(() => {});
    this.audioContext = null;
    this._deafened.set(false);
    this._joinedAt.set(null);

    try { await this.signaling.stopAsync(); } catch { /* já estava parada */ }

    this._channel.set(null);
    if (wasInRoom && notifyServer) this.setStatus('Você saiu do canal.');
  }

  /**
   * Troca de canal sem soltar o microfone: sai do canal atual no servidor e entra no novo com a
   * mesma conexão. Não precisa de outro clique, porque o AudioContext já existe.
   */
  async switchChannelAsync(channel: ChannelRef): Promise<void> {
    if (!this.inRoom() || this._channel()?.id === channel.id) return;

    // Marca o canal novo antes de sair do antigo, para a tela já mostrar o destino.
    this._channel.set(channel);
    this._joinedAt.set(Date.now());
    try { await this.signaling.leaveChannelAsync(); } catch { /* a conexão pode ter caído; o enterRoomAsync trata */ }
    try {
      await this.enterRoomAsync();
    } catch (error) {
      this.setStatus(`Não foi possível entrar em #${channel.name}: ${errorMessage(error)}`, 'error');
      await this.leaveAsync(false);
    }
  }

  // ---- microfone, áudio e dispositivos -------------------------------------

  /** Botão de mute. Com o áudio desativado, desmutar também reativa o áudio (como no Discord). */
  async toggleMuteAsync(): Promise<void> {
    if (!this.localStream) return;
    if (this._deafened()) {
      await this.setDeafenedAsync(false, false);
      await this.setMutedAsync(false);
    } else {
      await this.setMutedAsync(!this._muted());
    }
  }

  async setMutedAsync(muted: boolean): Promise<void> {
    if (!this.localStream || this._muted() === muted) return;
    this._muted.set(muted);
    // enabled=false manda silêncio sem renegociar a conexão.
    this.localStream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    this.patchParticipant(LOCAL_ID, { muted });

    try {
      await this.signaling.setMutedAsync(muted);
    } catch (error) {
      this.addLog(`Não foi possível avisar a sala sobre o mute: ${errorMessage(error)}`, 'warn');
    }
  }

  /**
   * "Desativar áudio": silencia todo mundo e muta o microfone. Só local: a sala vê você como
   * "mutado" (pelo aviso de mute que já existe).
   */
  async setDeafenedAsync(deafened: boolean, restoreMute = true): Promise<void> {
    if (this._deafened() === deafened || !this.inRoom()) return;
    this._deafened.set(deafened);
    if (deafened) {
      this.mutedBeforeDeafen = this._muted();
      await this.setMutedAsync(true);
    } else if (restoreMute) {
      await this.setMutedAsync(this.mutedBeforeDeafen);
    }
    this.setStatus(deafened ? 'Áudio desativado: você não ouve ninguém e está mutado.' : 'Áudio reativado.');
  }

  /** Troca o microfone durante a chamada (sem renegociar), mantendo o mute e o indicador de fala. */
  async selectMicAsync(deviceId: string | null, announce = true): Promise<void> {
    this._micId.set(deviceId || null);
    saveDevice('audioinput', this._micId());
    if (!this.localStream) return;

    let stream: MediaStream;
    try {
      stream = await this.captureMicAsync();
    } catch (error) {
      this.setStatus(`Não foi possível usar esse microfone: ${errorMessage(error)}`, 'error');
      return;
    }
    if (!this.inRoom() || !this.localStream) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const old = this.localStream;
    stream.getAudioTracks().forEach((t) => { t.enabled = !this._muted(); });
    this.watchMicEnded(stream);
    this.localStream = stream;
    await this.session?.replaceAudioTrackAsync(stream);
    this.speaking?.watch(LOCAL_ID, stream);
    old.getTracks().forEach((t) => { t.onended = null; t.stop(); });

    const label = stream.getAudioTracks()[0]?.label;
    this.setStatus(announce
      ? (label ? `Microfone: ${label}` : 'Microfone trocado.')
      : (label ? `Usando o microfone: ${label}` : 'Usando o microfone padrão.'));
  }

  /** Microfone em uso agora (para marcar no menu). */
  currentMicId(): string | null {
    return this.localStream?.getAudioTracks()[0]?.getSettings().deviceId ?? this._micId();
  }

  selectSpeaker(deviceId: string | null): void {
    this._speakerId.set(deviceId || null);
    saveDevice('audiooutput', this._speakerId());
  }

  setOutputVolume(volume: number): void {
    const value = Math.min(1, Math.max(0, volume));
    this._outputVolume.set(value);
    writePref('pq.volume', value);
  }

  /**
   * Analisador do microfone atual para o medidor de nível (só enquanto o menu está aberto).
   * Devolve null fora da chamada; chame o `dispose` ao fechar.
   */
  createMicAnalyser(): { analyser: AnalyserNode; dispose: () => void } | null {
    if (!this.audioContext || !this.localStream) return null;
    const source = this.audioContext.createMediaStreamSource(this.localStream);
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    return { analyser, dispose: () => source.disconnect() };
  }

  /** O navegador bloqueou o autoplay do áudio de alguém. */
  reportPlaybackBlocked(): void {
    this.setStatus('O navegador bloqueou a reprodução de áudio. Clique na página para liberar.', 'warn');
  }

  // ---- transmissão -----------------------------------------------------

  /** Botões de câmera/tela: ligam a transmissão daquele tipo ou, se já é a nossa, desligam. */
  async toggleStreamAsync(kind: StreamKind): Promise<void> {
    if (this._localVideoKind() === kind) await this.stopStreamAsync();
    else await this.startStreamAsync(kind);
  }

  async startStreamAsync(kind: StreamKind): Promise<void> {
    if (!this.session || this._localVideo() || this._startingStream()) return;
    const blockedBy = this.streamBlockedBy();
    if (blockedBy) {
      this.setStatus(`${blockedBy.name} já está transmitindo.`, 'warn');
      return;
    }

    this._startingStream.set(true);
    let media: MediaStream | null;
    try {
      // Pede a mídia primeiro (o seletor precisa do clique); só depois reserva a vez no servidor,
      // para não avisar a sala de uma transmissão que o usuário cancelou no seletor.
      media = await this.captureVideoAsync(kind);
    } catch (error) {
      this._startingStream.set(false);
      if (errorName(error) !== 'NotAllowedError' && errorName(error) !== 'AbortError') {
        this.setStatus(`Não foi possível capturar ${STREAM_LABELS[kind]}: ${errorMessage(error)}`, 'error');
      }
      return;
    }

    if (this._alwaysPreview()[kind]) {
      // Nada vai para a sala enquanto a prévia está aberta; cancelar encerra a captura.
      media = await new Promise<MediaStream | null>((resolve) => {
        this.previewResolve = resolve;
        this._preview.set({ kind, media: media! });
      });
      if (!media) {
        this._startingStream.set(false);
        return;
      }
      if (!this.inRoom() || !this.session || this.streamBlockedBy()) {
        media.getTracks().forEach((t) => t.stop());
        this._startingStream.set(false);
        return;
      }
    }

    const [track] = media.getVideoTracks();
    track.contentHint = kind === 'screen' ? 'detail' : 'motion';

    try {
      await this.signaling.startStreamAsync();
    } catch (error) {
      media.getTracks().forEach((t) => t.stop());
      this._startingStream.set(false);
      this.setStatus(`Não foi possível transmitir: ${errorMessage(error)}`, 'error');
      return;
    }

    this._startingStream.set(false);
    if (!this.inRoom() || !this.session) {
      // Saímos da sala enquanto o servidor respondia.
      media.getTracks().forEach((t) => t.stop());
      return;
    }

    this._localVideo.set(media);
    this._localVideoKind.set(kind);
    this._viewers.set(new Set());
    // "Parar compartilhamento" na barra do navegador (ou a câmera desconectada) também encerra.
    track.onended = () => void this.stopStreamAsync();
    // StreamStarted também chega para nós; marcamos já para a prévia aparecer sem esperar.
    this._streamer.set({ id: this.signaling.connectionId!, name: this._name() });
    await this.applyStreamBitrateAsync();
    await this.session.setVideoTrackAsync(track);
    this.setStatus(`Você está transmitindo ${STREAM_LABELS[kind]}.`);
  }

  async stopStreamAsync(notifyServer = true): Promise<void> {
    const media = this._localVideo();
    if (!media) return;
    this._localVideo.set(null);
    this._localVideoKind.set(null);

    for (const t of media.getTracks()) {
      t.onended = null;
      t.stop();
    }
    await this.session?.setVideoTrackAsync(null);
    // Próxima transmissão começa sem ninguém assistindo (cada pessoa escolhe de novo).
    await this.session?.clearVideoViewersAsync();
    this._viewers.set(new Set());
    if (this.isLocalStreamer()) this._streamer.set(null);

    if (notifyServer && this.signaling.isConnected) {
      try {
        await this.signaling.stopStreamAsync();
      } catch (error) {
        this.addLog(`Não foi possível avisar a sala do fim da transmissão: ${errorMessage(error)}`, 'warn');
      }
    }
  }

  /**
   * Começa/para de assistir a transmissão de outra pessoa. Quem transmite só envia (e codifica)
   * vídeo para quem avisou que está assistindo.
   */
  async setWatchingAsync(watching: boolean): Promise<void> {
    if (!this._streamer() || this.isLocalStreamer() || this._watching() === watching) return;
    this._watching.set(watching);
    try {
      await this.signaling.watchStreamAsync(watching);
    } catch (error) {
      this.setStatus(`Não foi possível ${watching ? 'começar a assistir' : 'parar de assistir'}: ${errorMessage(error)}`, 'warn');
    }
  }

  setAutoWatch(on: boolean): void {
    this._autoWatch.set(on);
    writePref('pq.autoWatch', on);
    if (on) void this.setWatchingAsync(true);
  }

  /** "Alterar a transmissão": abre o seletor de novo e troca a tela sem parar a transmissão. */
  async changeScreenAsync(): Promise<void> {
    if (this._localVideoKind() !== 'screen') return;
    let media: MediaStream;
    try {
      media = await this.captureVideoAsync('screen');
    } catch (error) {
      if (errorName(error) !== 'NotAllowedError' && errorName(error) !== 'AbortError') {
        this.setStatus(`Não foi possível trocar a tela: ${errorMessage(error)}`, 'error');
      }
      return; // cancelou o seletor: segue transmitindo a tela anterior
    }
    if (this._localVideoKind() !== 'screen') {
      media.getTracks().forEach((t) => t.stop());
      return;
    }
    await this.replaceLocalVideoAsync(media, 'screen');
    this.setStatus('Transmissão alterada.');
  }

  /** Câmera escolhida no menu. Se já estamos transmitindo a câmera, troca na hora. */
  async selectCameraAsync(deviceId: string | null): Promise<void> {
    this._cameraId.set(deviceId || null);
    saveDevice('videoinput', this._cameraId());
    if (this._localVideoKind() !== 'camera') return;
    try {
      let media: MediaStream;
      try {
        media = await this.captureVideoAsync('camera');
      } catch (error) {
        // Em muitos celulares só uma câmera pode ficar aberta: solta a atual e tenta de novo.
        if (errorName(error) !== 'NotReadableError') throw error;
        this._localVideo()?.getVideoTracks().forEach((t) => { t.onended = null; t.stop(); });
        media = await this.captureVideoAsync('camera');
      }
      if (this._localVideoKind() !== 'camera') {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      await this.replaceLocalVideoAsync(media, 'camera');
      this.setStatus('Câmera trocada.');
    } catch (error) {
      this.setStatus(`Não foi possível trocar a câmera: ${errorMessage(error)}`, 'error');
      if (this._localVideo()?.getVideoTracks().every((t) => t.readyState === 'ended')) await this.stopStreamAsync();
    }
  }

  /** Câmera em uso (para marcar no menu). */
  currentCameraId(): string | null {
    return this._localVideoKind() === 'camera'
      ? this._localVideo()?.getVideoTracks()[0]?.getSettings().deviceId ?? this._cameraId()
      : this._cameraId();
  }

  setQualityPref(kind: StreamKind, q: VideoQuality): void {
    const quality = normalizeQuality(kind, q);
    this._quality.update((all) => ({ ...all, [kind]: quality }));
    saveQuality(kind, quality);
  }

  /**
   * Qualidade escolhida no menu. Se esse tipo está no ar, aplica na hora: novo teto de captura
   * (applyConstraints, sem recapturar) e novo limite de envio em todas as conexões.
   */
  async changeQualityAsync(kind: StreamKind, q: VideoQuality): Promise<void> {
    this.setQualityPref(kind, q);
    const quality = this._quality()[kind];
    const media = this._localVideo();
    if (this._localVideoKind() !== kind || !media) return;
    try {
      await media.getVideoTracks()[0].applyConstraints(constraintsFor(kind, quality));
    } catch (error) {
      this.setStatus(`Não foi possível aplicar ${qualityLabel(quality)}: ${errorMessage(error)}`, 'warn');
      return;
    }
    await this.applyStreamBitrateAsync();
    this.setStatus(`Qualidade de ${STREAM_LABELS[kind]}: ${qualityLabel(quality)}.`);
  }

  async setUploadBudgetAsync(bps: number): Promise<void> {
    this._uploadBudget.set(bps);
    saveUploadBudget(bps);
    await this.applyStreamBitrateAsync();
  }

  setAlwaysPreview(kind: StreamKind, always: boolean): void {
    this._alwaysPreview.update((all) => ({ ...all, [kind]: always }));
    writePref(`pq.preview.${kind}`, always);
  }

  // ---- prévia antes de transmitir -----------------------------------------

  /** Prévia confirmada: transmite esta mídia (pode ser outra captura que a original). */
  confirmPreview(media: MediaStream): void {
    const resolve = this.previewResolve;
    this.previewResolve = null;
    this._preview.set(null);
    resolve?.(media);
  }

  /** Prévia cancelada (ou saímos do canal): encerra a captura sem transmitir. */
  cancelPreview(): void {
    const request = this._preview();
    const resolve = this.previewResolve;
    this.previewResolve = null;
    this._preview.set(null);
    request?.media.getTracks().forEach((t) => t.stop());
    resolve?.(null);
  }

  /** Recaptura para a prévia (outra tela, outra câmera ou outra qualidade). Para a captura anterior. */
  async recapturePreviewAsync(): Promise<void> {
    const request = this._preview();
    if (!request) return;
    let media: MediaStream;
    try {
      media = await this.captureVideoAsync(request.kind);
    } catch (error) {
      if (errorName(error) !== 'NotAllowedError' && errorName(error) !== 'AbortError') {
        this.setStatus(`Não foi possível capturar ${STREAM_LABELS[request.kind]}: ${errorMessage(error)}`, 'warn');
      }
      return;
    }
    if (this._preview() !== request) {
      media.getTracks().forEach((t) => t.stop());
      return;
    }
    request.media.getTracks().forEach((t) => t.stop());
    this._preview.set({ kind: request.kind, media });
  }

  // ---- estatísticas ------------------------------------------------------

  collectStatsAsync(): Promise<PeerStats[]> {
    return this.session?.collectStatsAsync() ?? Promise.resolve([]);
  }

  // ---- sessão ----------------------------------------------------------

  /** Entra (ou reentra, após reconexão) na sala com a conexão SignalR atual. */
  private async enterRoomAsync(): Promise<void> {
    await this.resetSessionAsync();
    const session = await this.createSessionAsync();
    this.session = session;

    const channel = this._channel()!;
    const { participants: existing, streamer } = await this.signaling.joinChannelAsync(channel.id);
    for (const p of existing) {
      this.upsertParticipant(p.connectionId, { name: p.name, muted: p.muted });
    }
    // StreamStarted pode ter chegado antes da resposta; a resposta é o retrato no momento da entrada.
    if (streamer && !this._streamer()) this.setStreamer({ id: streamer.connectionId, name: streamer.name });
    if (this._muted()) await this.signaling.setMutedAsync(true);

    // Nós acabamos de entrar: somos quem manda as offers.
    await session.connectToAsync(existing.map((p) => p.connectionId));

    this.setStatus(existing.length === 0
      ? `Você está em #${channel.name}. Aguardando mais alguém…`
      : `Você está em #${channel.name} com ${existing.length} ${existing.length === 1 ? 'pessoa' : 'pessoas'}.`);
  }

  private async createSessionAsync(): Promise<MeshVoiceSession> {
    const codec = await this.codecChoice;
    return new MeshVoiceSession({
      signaling: this.signaling,
      localStream: this.localStream!,
      iceServers: this.config.iceServers,
      videoMaxBitrate: this.config.videoMaxBitrate,
      preferredVideoCodec: codec.mimeType,
      onPeerState: (id, connection) => {
        if (!this._participants().has(id)) return;
        this.patchParticipant(id, { connection });
        if (connection === 'connected') this.addLog(`Áudio conectado com ${this.nameOf(id)}`);
      },
      onRemoteStream: (id, stream) => {
        this.upsertParticipant(id, { audio: stream });
        this.speaking?.watch(id, stream);
      },
      onRemoteVideo: (id, track) => {
        this._remoteVideo.update((map) => new Map(map).set(id, track));
      },
      onPeerFailed: (id) => this.setStatus(
        `Não foi possível conectar o áudio com ${this.nameOf(id)}. Em algumas redes (NAT simétrico, firewall corporativo, 4G) é preciso um servidor TURN — configure em core/config/voice.config.ts.`,
        'error'),
      onError: (id, error) => this.addLog(`Erro de sinalização com ${this.nameOf(id)}: ${errorMessage(error)}`, 'error'),
    });
  }

  private async resetSessionAsync(): Promise<void> {
    // O servidor encerra a transmissão sozinho quando saímos ou caímos; aqui só soltamos a captura.
    await this.stopStreamAsync(false);
    this.session?.close();
    this.session = null;
    this.setStreamer(null);
    this._remoteVideo.set(new Map());
    for (const id of this._participants().keys()) {
      if (id !== LOCAL_ID) this.removeParticipant(id);
    }
  }

  /** Quem transmite mudou: ninguém está assistindo até escolher de novo (ou assistir automático). */
  private setStreamer(streamer: Streamer | null): void {
    const changed = this._streamer()?.id !== streamer?.id;
    this._streamer.set(streamer);
    if (!changed) return;
    this._watching.set(false);
    this._viewers.set(new Set());
    if (streamer && streamer.id !== this.signaling.connectionId && this._autoWatch()) void this.setWatchingAsync(true);
  }

  /** Limite de envio por pessoa: o da qualidade, com o teto de upload dividido entre quem assiste. */
  private async applyStreamBitrateAsync(): Promise<void> {
    const kind = this._localVideoKind();
    if (!kind || !this.session) return;
    await this.session.setVideoMaxBitrateAsync(perViewerBitrate(this._quality()[kind], this._viewers().size, this._uploadBudget()));
  }

  /** Troca o vídeo de uma transmissão em andamento sem avisar o servidor nem renegociar. */
  private async replaceLocalVideoAsync(media: MediaStream, kind: StreamKind): Promise<void> {
    const old = this._localVideo();
    const [track] = media.getVideoTracks();
    track.contentHint = kind === 'screen' ? 'detail' : 'motion';
    track.onended = () => void this.stopStreamAsync();
    this._localVideo.set(media);
    this._localVideoKind.set(kind);
    await this.session?.setVideoTrackAsync(track);
    for (const t of old?.getTracks() ?? []) {
      t.onended = null;
      t.stop();
    }
  }

  /** Captura a tela (seletor do navegador) ou a câmera escolhida, na qualidade escolhida. */
  private async captureVideoAsync(kind: StreamKind): Promise<MediaStream> {
    const constraints = constraintsFor(kind, this._quality()[kind]);
    if (kind === 'screen') {
      return navigator.mediaDevices.getDisplayMedia({ video: constraints, audio: false });
    }
    try {
      return await navigator.mediaDevices.getUserMedia({ video: withDevice(constraints, this._cameraId()), audio: false });
    } catch (error) {
      if (!this._cameraId() || !isMissingDevice(error)) throw error;
      // A câmera escolhida foi desconectada (ou o id mudou): volta para a padrão.
      this.setStatus('A câmera escolhida não está disponível. Usando a câmera padrão.', 'warn');
      this._cameraId.set(null);
      saveDevice('videoinput', null);
      return navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
    }
  }

  /** Abre o microfone escolhido; se ele não existir mais, usa o padrão. */
  private async captureMicAsync(): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: withDevice(this.config.audioConstraints, this._micId()), video: false });
    } catch (error) {
      if (!this._micId() || !isMissingDevice(error)) throw error;
      this.addLog('O microfone escolhido não está disponível; usando o padrão.', 'warn');
      this._micId.set(null);
      saveDevice('audioinput', null);
      return navigator.mediaDevices.getUserMedia({ audio: this.config.audioConstraints, video: false });
    }
  }

  /** Microfone desconectado no meio da chamada (ex.: fone Bluetooth): volta para o padrão. */
  private watchMicEnded(stream: MediaStream): void {
    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        if (!this.inRoom() || this.localStream !== stream) return;
        this.setStatus('O microfone foi desconectado. Tentando o microfone padrão…', 'warn');
        void this.selectMicAsync(null, false);
      };
    }
  }

  private registerSignalingHandlers(): void {
    this.signaling.setHandlers({
      userJoined: (id, name) => {
        if (!this.inRoom()) return;
        this.upsertParticipant(id, { name });
        this.setStatus(`${name} entrou no canal`);
        this.events.next({ type: 'joined', id, name });
        // Não criamos a conexão aqui: quem entrou é quem manda a offer.
      },
      userLeft: (id) => {
        const name = this._participants().get(id)?.name;
        if (this._viewers().has(id)) {
          this._viewers.update((set) => new Set([...set].filter((v) => v !== id)));
          void this.applyStreamBitrateAsync();
        }
        void this.session?.setPeerVideoEnabledAsync(id, false);
        if (this._streamer()?.id === id) this.setStreamer(null);
        this.session?.removePeer(id);
        this.removeParticipant(id);
        if (name) {
          this.addLog(`${name} saiu do canal`);
          this.events.next({ type: 'left', id, name });
        }
      },
      userMuted: (id, muted) => this.patchParticipant(id, { muted }),
      streamStarted: (id, name) => {
        if (!this.inRoom()) return;
        this.setStreamer({ id, name });
        const self = id === this.signaling.connectionId;
        if (!self) this.setStatus(`${name} começou a transmitir`);
        this.events.next({ type: 'stream-started', id, name, self });
      },
      streamStopped: (id) => {
        const streamer = this._streamer();
        if (streamer?.id !== id) return;
        this.setStreamer(null);
        const self = id === this.signaling.connectionId;
        if (!self) this.addLog(`${streamer.name} parou de transmitir`);
        this.events.next({ type: 'stream-stopped', id, name: streamer.name, self });
      },
      viewerChanged: (id, watching) => {
        if (!this.isLocalStreamer()) return; // a transmissão acabou no caminho
        this._viewers.update((set) => {
          const next = new Set(set);
          if (watching) next.add(id); else next.delete(id);
          return next;
        });
        void this.session?.setPeerVideoEnabledAsync(id, watching);
        void this.applyStreamBitrateAsync(); // o teto de upload é dividido entre quem assiste
      },
      chatMessage: (message) => {
        if (this.inRoom()) this.events.next({ type: 'chat', message });
      },
      userTyping: (id) => {
        if (this.inRoom()) this.events.next({ type: 'typing', id });
      },
      channelDeleted: (channelId) => {
        this._deletedChannelId.set(channelId);
        if (this._channel()?.id !== channelId || !this.inRoom()) return;
        // O servidor já tirou todo mundo do canal; aqui só soltamos microfone e conexões.
        void this.leaveAsync(false).then(() => this.setStatus('Este canal foi excluído pelo dono do servidor.', 'warn'));
      },
      kicked: (reason) => {
        void this.leaveAsync(false).then(() => {
          this.setStatus(reason, 'warn');
          this._kicked.set({ reason, at: Date.now() });
        });
      },
      receiveOffer: (fromId, offer) => {
        if (!this._participants().has(fromId)) this.upsertParticipant(fromId, {});
        void this.session?.handleOfferAsync(fromId, offer);
      },
      receiveAnswer: (fromId, answer) => void this.session?.handleAnswerAsync(fromId, answer),
      receiveIceCandidate: (fromId, candidate) => void this.session?.handleIceCandidateAsync(fromId, candidate),
    });

    this.signaling.onReconnecting(() => {
      if (!this.inRoom()) return;
      this.setStatus('Conexão com o servidor caiu. Reconectando…', 'warn');
      // O servidor já nos tirou do canal; os outros vão fechar as conexões conosco.
      void this.resetSessionAsync();
    });

    this.signaling.onReconnected(async () => {
      if (!this.inRoom()) return;
      this.setStatus('Reconectado. Voltando para o canal…');
      try {
        await this.enterRoomAsync();
      } catch (error) {
        this.setStatus(`Não foi possível voltar para o canal: ${errorMessage(error)}`, 'error');
        await this.leaveAsync(false);
      }
    });

    this.signaling.onClose((error) => {
      if (!this.inRoom()) return;
      this.setStatus(`Conexão com o servidor perdida${error ? `: ${error.message}` : ''}.`, 'error');
      void this.leaveAsync(false);
    });
  }

  // ---- participantes ---------------------------------------------------

  private upsertParticipant(id: string, patch: Partial<RoomParticipant>): void {
    this._participants.update((map) => {
      const current = map.get(id) ?? {
        id, name: '…', muted: false, speaking: false, connection: 'waiting', audio: null, isLocal: false,
      };
      return new Map(map).set(id, { ...current, ...patch, id });
    });
  }

  /** Como upsert, mas ignora quem não está na lista. */
  private patchParticipant(id: string, patch: Partial<RoomParticipant>): void {
    if (this._participants().has(id)) this.upsertParticipant(id, patch);
  }

  private removeParticipant(id: string): void {
    if (!this._participants().has(id)) return;
    this.speaking?.unwatch(id);
    this._participants.update((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });
    this._remoteVideo.update((map) => {
      if (!map.has(id)) return map;
      const next = new Map(map);
      next.delete(id);
      return next;
    });
  }

  private nameOf(id: string): string {
    return this._participants().get(id)?.name ?? id;
  }

  // ---- status ----------------------------------------------------------

  setStatus(message: string, level: StatusLevel = 'info'): void {
    this._status.set(this.addLog(message, level));
  }

  private addLog(message: string, level: StatusLevel = 'info'): StatusEntry {
    const entry: StatusEntry = { id: ++this.logSeq, at: new Date(), message, level };
    this._log.update((log) => [entry, ...log].slice(0, MAX_LOG_ENTRIES));
    (level === 'error' ? console.error : console.log)(`[voz] ${message}`);
    return entry;
  }
}
