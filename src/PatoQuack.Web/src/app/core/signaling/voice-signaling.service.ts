import { Injectable, inject } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { VOICE_CONFIG } from '../config/voice.config';
import {
  ChatHistoryDto, ChatMessageDto, JoinChannelResultDto, SessionDescriptionDto, SignalingChannel, VoiceClientHandlers,
} from './voice.models';

/**
 * Camada fina sobre o HubConnection do SignalR. Concentra os nomes dos métodos e eventos do
 * VoiceHub num lugar só; o resto do app não conhece o SignalR.
 */
@Injectable({ providedIn: 'root' })
export class VoiceSignalingService implements SignalingChannel {
  private readonly connection = new signalR.HubConnectionBuilder()
    .withUrl(inject(VOICE_CONFIG).hubUrl)
    .withAutomaticReconnect()
    .configureLogging(signalR.LogLevel.Warning)
    .build();

  get connectionId(): string | null {
    return this.connection.connectionId;
  }

  get isConnected(): boolean {
    return this.connection.state === signalR.HubConnectionState.Connected;
  }

  setHandlers(handlers: VoiceClientHandlers): void {
    this.connection.on('UserJoined', handlers.userJoined);
    this.connection.on('UserLeft', handlers.userLeft);
    this.connection.on('UserMuted', handlers.userMuted);
    this.connection.on('StreamStarted', handlers.streamStarted);
    this.connection.on('StreamStopped', handlers.streamStopped);
    this.connection.on('ChannelDeleted', handlers.channelDeleted);
    this.connection.on('ViewerChanged', handlers.viewerChanged);
    this.connection.on('ChatMessage', handlers.chatMessage);
    this.connection.on('UserTyping', handlers.userTyping);
    this.connection.on('Kicked', handlers.kicked);
    this.connection.on('ReceiveOffer', handlers.receiveOffer);
    this.connection.on('ReceiveAnswer', handlers.receiveAnswer);
    this.connection.on('ReceiveIceCandidate', handlers.receiveIceCandidate);
  }

  onReconnecting(callback: (error?: Error) => void): void { this.connection.onreconnecting(callback); }
  onReconnected(callback: (connectionId?: string) => void): void { this.connection.onreconnected(callback); }
  onClose(callback: (error?: Error) => void): void { this.connection.onclose(callback); }

  startAsync(): Promise<void> { return this.connection.start(); }
  stopAsync(): Promise<void> { return this.connection.stop(); }

  /** Entra no canal com o usuário da sessão (o nome vem da conta). */
  joinChannelAsync(channelId: string): Promise<JoinChannelResultDto> {
    return this.connection.invoke<JoinChannelResultDto>('JoinChannel', channelId);
  }

  leaveChannelAsync(): Promise<void> { return this.connection.invoke('LeaveChannel'); }
  setMutedAsync(muted: boolean): Promise<void> { return this.connection.invoke('SetMuted', muted); }
  startStreamAsync(): Promise<void> { return this.connection.invoke('StartStream'); }
  stopStreamAsync(): Promise<void> { return this.connection.invoke('StopStream'); }
  /** Avisa quem transmite que começamos (true) ou paramos (false) de assistir. */
  watchStreamAsync(watching: boolean): Promise<void> { return this.connection.invoke('WatchStream', watching); }

  sendChatMessageAsync(text: string): Promise<ChatMessageDto> {
    return this.connection.invoke<ChatMessageDto>('SendChatMessage', text);
  }

  /** Página do histórico: as mais recentes antes de `beforeId` (ou as mais recentes, se null). */
  getChatHistoryAsync(beforeId: number | null): Promise<ChatHistoryDto> {
    return this.connection.invoke<ChatHistoryDto>('GetChatHistory', beforeId);
  }

  typingAsync(): Promise<void> { return this.connection.invoke('Typing'); }

  sendOffer(targetId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    return this.connection.invoke('SendOffer', targetId, toDescription(offer));
  }

  sendAnswer(targetId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    return this.connection.invoke('SendAnswer', targetId, toDescription(answer));
  }

  sendIceCandidate(targetId: string, candidate: RTCIceCandidateInit): Promise<void> {
    return this.connection.invoke('SendIceCandidate', targetId, candidate);
  }
}

// RTCSessionDescription não serializa bem em todos os navegadores; mandamos só o necessário.
function toDescription(description: RTCSessionDescriptionInit): SessionDescriptionDto {
  return { type: description.type, sdp: description.sdp ?? '' };
}
