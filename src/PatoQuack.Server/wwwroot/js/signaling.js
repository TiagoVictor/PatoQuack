// Camada fina sobre o HubConnection do SignalR.
// Concentra os nomes dos métodos/eventos do VoiceHub num lugar só.
// `signalR` é global, carregado pelo <script> do CDN no index.html.

export class VoiceSignaling {
  constructor(hubUrl) {
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl)
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build();
  }

  get connectionId() {
    return this.connection.connectionId;
  }

  get isConnected() {
    return this.connection.state === signalR.HubConnectionState.Connected;
  }

  /**
   * Registra os handlers dos eventos enviados pelo servidor (IVoiceClient no C#).
   * @param {{
   *   userJoined: (id: string, name: string) => void,
   *   userLeft: (id: string) => void,
   *   userMuted: (id: string, muted: boolean) => void,
   *   streamStarted: (id: string, name: string) => void,
   *   streamStopped: (id: string) => void,
   *   receiveOffer: (fromId: string, offer: RTCSessionDescriptionInit) => void,
   *   receiveAnswer: (fromId: string, answer: RTCSessionDescriptionInit) => void,
   *   receiveIceCandidate: (fromId: string, candidate: RTCIceCandidateInit) => void,
   * }} handlers
   */
  setHandlers(handlers) {
    this.connection.on('UserJoined', handlers.userJoined);
    this.connection.on('UserLeft', handlers.userLeft);
    this.connection.on('UserMuted', handlers.userMuted);
    this.connection.on('StreamStarted', handlers.streamStarted);
    this.connection.on('StreamStopped', handlers.streamStopped);
    this.connection.on('ViewerChanged', handlers.viewerChanged);
    this.connection.on('ChatMessage', handlers.chatMessage);
    this.connection.on('UserTyping', handlers.userTyping);
    this.connection.on('ReceiveOffer', handlers.receiveOffer);
    this.connection.on('ReceiveAnswer', handlers.receiveAnswer);
    this.connection.on('ReceiveIceCandidate', handlers.receiveIceCandidate);
  }

  onReconnecting(cb) { this.connection.onreconnecting(cb); }
  onReconnected(cb) { this.connection.onreconnected(cb); }
  onClose(cb) { this.connection.onclose(cb); }

  start() { return this.connection.start(); }
  stop() { return this.connection.stop(); }

  /**
   * @returns {Promise<{
   *   participants: Array<{connectionId: string, name: string, muted: boolean}>,
   *   streamer: {connectionId: string, name: string} | null,
   * }>}
   */
  joinRoom(room, name) { return this.connection.invoke('JoinRoom', room, name); }
  leaveRoom() { return this.connection.invoke('LeaveRoom'); }
  setMuted(muted) { return this.connection.invoke('SetMuted', muted); }
  startStream() { return this.connection.invoke('StartStream'); }
  stopStream() { return this.connection.invoke('StopStream'); }
  /** Avisa quem transmite que começamos (true) ou paramos (false) de assistir. */
  watchStream(watching) { return this.connection.invoke('WatchStream', watching); }

  // Chat de texto
  sendChatMessage(text) { return this.connection.invoke('SendChatMessage', text); }
  /** Página do histórico (as mais recentes antes de beforeId, ou as mais recentes se null). */
  getChatHistory(beforeId) { return this.connection.invoke('GetChatHistory', beforeId); }
  typing() { return this.connection.invoke('Typing'); }

  sendOffer(targetId, offer) { return this.connection.invoke('SendOffer', targetId, toDescription(offer)); }
  sendAnswer(targetId, answer) { return this.connection.invoke('SendAnswer', targetId, toDescription(answer)); }
  sendIceCandidate(targetId, candidate) { return this.connection.invoke('SendIceCandidate', targetId, candidate); }
}

// RTCSessionDescription não serializa bem em todos os navegadores; mandamos só o necessário.
function toDescription(desc) {
  return { type: desc.type, sdp: desc.sdp };
}
