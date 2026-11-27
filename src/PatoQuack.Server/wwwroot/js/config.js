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

// Transmissão de vídeo (tela/câmera): qualidades que a pessoa pode escolher.
// A resolução e o FPS são um TETO pedido ao navegador: a câmera não passa do que o hardware faz,
// e o WebRTC reduz sozinho quando falta banda/CPU (o selo do palco mostra o que realmente chega).
// Cada resolução tem seu limite de envio (bitrate): sem isso, mais pixels só dividiriam o mesmo
// fluxo. Os valores são um ponto de partida (estimativa), não um padrão — ajustar se ficar ruim.
// Em malha P2P quem transmite envia uma cópia para cada pessoa: o upload é bitrate × pessoas.
export const VIDEO_RESOLUTIONS = [
  { id: '480', label: '480p', height: 480, bitrate: 1_000_000 },
  { id: '720', label: '720p', height: 720, bitrate: 2_500_000 },
  { id: '1080', label: '1080p', height: 1080, bitrate: 4_500_000 },
  // "Original" da tela, limitado a 1440p para não estourar em telas Retina/4K.
  { id: 'source', label: 'Original', height: 1440, bitrate: 6_000_000, screenOnly: true },
];
export const VIDEO_FRAME_RATES = [15, 30, 60];
export const HIGH_FPS = 60;
export const HIGH_FPS_BITRATE_FACTOR = 1.5; // 60 FPS gasta mais banda para a mesma nitidez
// Padrão por tipo. Tela: texto parado não precisa de 30 FPS; 15 FPS em 1080p mantém o texto nítido
// gastando menos CPU e banda. Câmera: movimento, então 30 FPS.
export const DEFAULT_VIDEO_QUALITY = {
  camera: { resolution: '720', fps: 30 },
  screen: { resolution: '1080', fps: 15 },
};

// Teto de upload de vídeo de quem transmite, dividido entre quem está assistindo
// (bitrate por pessoa = min(bitrate da qualidade, teto ÷ pessoas assistindo)). 0 = sem limite.
export const UPLOAD_BUDGETS = [5_000_000, 10_000_000, 20_000_000, 0];
export const DEFAULT_UPLOAD_BUDGET = 10_000_000;
// Abaixo disso o vídeo fica inútil: preferimos passar um pouco do teto.
export const MIN_VIEWER_BITRATE = 300_000;
