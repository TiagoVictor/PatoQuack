// Contratos do VoiceHub (espelham os DTOs de PatoQuack.Server/Voice/VoiceContracts.cs).

export interface ParticipantDto {
  connectionId: string;
  name: string;
  muted: boolean;
}

export interface StreamerDto {
  connectionId: string;
  name: string;
}

export interface JoinChannelResultDto {
  participants: ParticipantDto[];
  streamer: StreamerDto | null;
}

export interface ChatMessageDto {
  id: number;
  authorName: string;
  text: string;
  sentAt: string;
  /** Só nas mensagens ao vivo (no histórico vem null). */
  authorConnectionId: string | null;
}

export interface ChatHistoryDto {
  messages: ChatMessageDto[];
  hasMore: boolean;
}

export interface SessionDescriptionDto {
  type: RTCSdpType;
  sdp: string;
}

/** Eventos que o servidor manda para o cliente (IVoiceClient no C#). */
export interface VoiceClientHandlers {
  userJoined(connectionId: string, name: string): void;
  userLeft(connectionId: string): void;
  userMuted(connectionId: string, muted: boolean): void;
  streamStarted(connectionId: string, name: string): void;
  streamStopped(connectionId: string): void;
  channelDeleted(channelId: string): void;
  /** Só para quem transmite: alguém começou/parou de assistir. */
  viewerChanged(viewerConnectionId: string, watching: boolean): void;
  chatMessage(message: ChatMessageDto): void;
  userTyping(connectionId: string): void;
  /** O servidor nos tirou do canal (ex.: saímos do servidor). */
  kicked(reason: string): void;
  receiveOffer(fromConnectionId: string, offer: RTCSessionDescriptionInit): void;
  receiveAnswer(fromConnectionId: string, answer: RTCSessionDescriptionInit): void;
  receiveIceCandidate(fromConnectionId: string, candidate: RTCIceCandidateInit): void;
}

/** O que a sessão WebRTC precisa da sinalização (permite trocar/mocar o transporte). */
export interface SignalingChannel {
  sendOffer(targetId: string, offer: RTCSessionDescriptionInit): Promise<void>;
  sendAnswer(targetId: string, answer: RTCSessionDescriptionInit): Promise<void>;
  sendIceCandidate(targetId: string, candidate: RTCIceCandidateInit): Promise<void>;
}
