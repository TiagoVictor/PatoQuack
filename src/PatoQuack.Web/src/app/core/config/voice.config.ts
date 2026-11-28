import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';

/** Configuração do cliente de voz. Injetável para que testes (ou outro ambiente) possam trocar. */
export interface VoiceConfig {
  hubUrl: string;
  /**
   * Servidores ICE das RTCPeerConnection. STUN descobre o IP público e resolve a maioria das
   * redes domésticas; atrás de NAT simétrico ou firewall corporativo é preciso TURN.
   */
  iceServers: RTCIceServer[];
  audioConstraints: MediaTrackConstraints;
  /** RMS (0..1) acima do qual consideramos fala. */
  speakingThreshold: number;
  /** Tempo que o indicador de fala fica aceso depois da fala parar. */
  speakingHoldMs: number;
  /**
   * Limite de bitrate do vídeo por conexão. Em malha P2P quem transmite envia uma cópia para
   * cada pessoa (5 assistindo = até 5× este valor de upload).
   */
  videoMaxBitrate: number;
  cameraConstraints: MediaTrackConstraints;
  screenConstraints: MediaTrackConstraints;
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  hubUrl: environment.hubUrl,
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // TURN (ex.: coturn próprio ou serviço gerenciado). Descomente e preencha:
    // {
    //   urls: ['turn:turn.seudominio.com:3478?transport=udp', 'turns:turn.seudominio.com:5349?transport=tcp'],
    //   username: 'usuario',
    //   credential: 'senha',
    // },
  ],
  audioConstraints: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  speakingThreshold: 0.015,
  speakingHoldMs: 300,
  videoMaxBitrate: 2_500_000,
  cameraConstraints: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  screenConstraints: { frameRate: { ideal: 30 } },
};

export const VOICE_CONFIG = new InjectionToken<VoiceConfig>('VOICE_CONFIG', {
  providedIn: 'root',
  factory: () => DEFAULT_VOICE_CONFIG,
});
