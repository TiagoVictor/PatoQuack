// Configuração do cliente de voz.

export const HUB_URL = '/hubs/voice';

// Servidores ICE usados pelas RTCPeerConnection.
// STUN descobre o IP público; resolve a maioria das redes domésticas.
// Atrás de NAT simétrico ou firewall corporativo é preciso TURN (relay de mídia).
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },

  // TURN (ex.: coturn próprio ou um serviço gerenciado). Descomente e preencha:
  // {
  //   urls: ['turn:turn.seudominio.com:3478?transport=udp', 'turns:turn.seudominio.com:5349?transport=tcp'],
  //   username: 'usuario',
  //   credential: 'senha',
  // },
];

export const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

// Indicador de "falando"
export const SPEAKING_THRESHOLD = 0.015; // RMS (0..1) acima do qual consideramos fala
export const SPEAKING_HOLD_MS = 300;     // tempo que o indicador fica aceso depois da fala parar
