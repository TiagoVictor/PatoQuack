import { StatusLevel } from '../../../shared/ui';

/** Estado da conexão WebRTC com o participante, mais "local" (você) e "waiting". */
export type PeerConnectionState = RTCPeerConnectionState | 'local' | 'waiting';

export interface RoomParticipant {
  id: string;
  name: string;
  muted: boolean;
  speaking: boolean;
  connection: PeerConnectionState;
  /** Áudio recebido (participantes remotos). */
  audio: MediaStream | null;
  isLocal: boolean;
}

export interface Streamer {
  id: string;
  name: string;
}

export type { StreamKind } from '../../../core/media/quality';

export interface StatusEntry {
  id: number;
  at: Date;
  message: string;
  level: StatusLevel;
}

export type VoicePhase = 'idle' | 'joining' | 'in-room';

/** Canal de voz em que a pessoa está (ou vai entrar). */
export interface ChannelRef {
  id: string;
  name: string;
}

/** Eventos da chamada para quem não é a tela de voz (ex.: o chat mostra "Ana entrou"). */
export type VoiceEvent =
  | { type: 'joined'; id: string; name: string }
  | { type: 'left'; id: string; name: string }
  | { type: 'stream-started'; id: string; name: string; self: boolean }
  | { type: 'stream-stopped'; id: string; name: string; self: boolean }
  | { type: 'chat'; message: import('../../../core/signaling/voice.models').ChatMessageDto }
  | { type: 'typing'; id: string };

/** Pedido de prévia antes de transmitir: a janela de prévia mostra e devolve a mídia (ou null). */
export interface PreviewRequest {
  kind: import('../../../core/media/quality').StreamKind;
  media: MediaStream;
}
