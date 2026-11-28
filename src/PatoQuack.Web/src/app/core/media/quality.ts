// Qualidade da transmissão (resolução + FPS), limite de envio e teto de upload dividido entre
// quem assiste. A resolução e o FPS são um TETO pedido ao navegador: a câmera não passa do que o
// hardware faz, e o WebRTC reduz sozinho quando falta banda/CPU.

import { readNumber, readString, writePref } from './preferences';

export type StreamKind = 'camera' | 'screen';

export interface VideoQuality {
  resolution: string;
  fps: number;
}

export interface ResolutionOption {
  id: string;
  label: string;
  height: number;
  /** Limite de envio por conexão (bps). Mais pixels sem mais bitrate só piorariam a imagem. */
  bitrate: number;
  screenOnly?: boolean;
}

export const VIDEO_RESOLUTIONS: ResolutionOption[] = [
  { id: '480', label: '480p', height: 480, bitrate: 1_000_000 },
  { id: '720', label: '720p', height: 720, bitrate: 2_500_000 },
  { id: '1080', label: '1080p', height: 1080, bitrate: 4_500_000 },
  // "Original" da tela, limitado a 1440p para não estourar em telas Retina/4K.
  { id: 'source', label: 'Original', height: 1440, bitrate: 6_000_000, screenOnly: true },
];
export const VIDEO_FRAME_RATES = [15, 30, 60];
const HIGH_FPS = 60;
const HIGH_FPS_BITRATE_FACTOR = 1.5;

/** Tela: texto parado não precisa de 30 FPS; 1080p 15 FPS mantém o texto nítido. Câmera: movimento. */
export const DEFAULT_VIDEO_QUALITY: Record<StreamKind, VideoQuality> = {
  camera: { resolution: '720', fps: 30 },
  screen: { resolution: '1080', fps: 15 },
};

/** Teto de upload de vídeo de quem transmite, dividido entre quem assiste. 0 = sem limite. */
export const UPLOAD_BUDGETS = [5_000_000, 10_000_000, 20_000_000, 0];
export const DEFAULT_UPLOAD_BUDGET = 10_000_000;
/** Abaixo disso o vídeo fica inútil: preferimos passar um pouco do teto. */
const MIN_VIEWER_BITRATE = 300_000;

export const resolutionsFor = (kind: StreamKind) => VIDEO_RESOLUTIONS.filter((r) => kind === 'screen' || !r.screenOnly);

const resolutionOf = (q: VideoQuality) => VIDEO_RESOLUTIONS.find((r) => r.id === q.resolution) ?? VIDEO_RESOLUTIONS[1];

/** Garante uma qualidade válida para o tipo (ex.: preferência antiga ou "Original" na câmera). */
export function normalizeQuality(kind: StreamKind, q: Partial<VideoQuality> | null | undefined): VideoQuality {
  const fallback = DEFAULT_VIDEO_QUALITY[kind];
  const resolution = resolutionsFor(kind).some((r) => r.id === q?.resolution) ? q!.resolution! : fallback.resolution;
  const fps = VIDEO_FRAME_RATES.includes(Number(q?.fps)) ? Number(q!.fps) : fallback.fps;
  return { resolution, fps };
}

export function loadQuality(kind: StreamKind): VideoQuality {
  const [resolution, fps] = (readString(`pq.quality.${kind}`) ?? '').split('@');
  return normalizeQuality(kind, { resolution, fps: Number(fps) });
}

export const saveQuality = (kind: StreamKind, q: VideoQuality) => writePref(`pq.quality.${kind}`, `${q.resolution}@${q.fps}`);

export function loadUploadBudget(): number {
  const value = readNumber('pq.uploadBudget', DEFAULT_UPLOAD_BUDGET);
  return UPLOAD_BUDGETS.includes(value) ? value : DEFAULT_UPLOAD_BUDGET;
}

export const saveUploadBudget = (bps: number) => writePref('pq.uploadBudget', bps);

/** Limite de envio (bps) por conexão para a qualidade. */
export function bitrateFor(q: VideoQuality): number {
  const base = resolutionOf(q).bitrate;
  return q.fps >= HIGH_FPS ? Math.round(base * HIGH_FPS_BITRATE_FACTOR) : base;
}

/**
 * Constraints de vídeo para capturar (ou aplicar com applyConstraints) na qualidade pedida.
 * Câmera: só `ideal` (um `max` que a câmera não cumpre faria a captura falhar).
 * Tela: `max` (getDisplayMedia não aceita min/exact) — reduz a imagem sem distorcer.
 */
export function constraintsFor(kind: StreamKind, q: VideoQuality): MediaTrackConstraints {
  const { height } = resolutionOf(q);
  if (kind === 'camera') {
    return { width: { ideal: Math.round((height * 16) / 9) }, height: { ideal: height }, frameRate: { ideal: q.fps } };
  }
  return { height: { max: height }, frameRate: { ideal: q.fps, max: q.fps } };
}

const mbps = (bps: number) => (bps / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export const qualityLabel = (q: VideoQuality) => `${resolutionOf(q).label} ${q.fps} FPS`;

export const budgetLabel = (bps: number) => (bps ? `${mbps(bps)} Mbps` : 'Sem limite');

/** Limite por pessoa: o da qualidade, reduzido para caber no teto dividido entre quem assiste. */
export function perViewerBitrate(q: VideoQuality, viewers: number, budget: number): number {
  const base = bitrateFor(q);
  if (!budget || viewers <= 0) return base;
  return Math.max(MIN_VIEWER_BITRATE, Math.min(base, Math.floor(budget / viewers)));
}

/** Texto da estimativa de upload: bitrate por pessoa × quem está assistindo, dentro do teto. */
export function uploadEstimate(q: VideoQuality, viewers: number, budget: number): string {
  if (viewers <= 0) {
    const cap = budget ? ` · no máximo ${mbps(budget)} Mbps no total` : '';
    return `≈ ${mbps(bitrateFor(q))} Mbps por pessoa que assistir${cap}`;
  }
  const per = perViewerBitrate(q, viewers, budget);
  const who = viewers === 1 ? '1 pessoa assistindo' : `${viewers} pessoas assistindo`;
  const reduced = per < bitrateFor(q) ? ' · reduzido pelo upload máximo' : '';
  return `≈ ${mbps(per * viewers)} Mbps de upload (${mbps(per)} Mbps × ${who})${reduced}`;
}

// ---- codec de vídeo ------------------------------------------------------------
//
// Cada conexão codifica o vídeo separadamente: com várias pessoas assistindo, um codificador por
// hardware poupa muita CPU (medido no Mac, 4 pessoas assistindo 720p: H.264 por hardware ~45% de
// um núcleo contra ~95% do VP8). Preferimos H.264 quando o navegador informa que ele é eficiente
// OU no macOS (todo Mac tem H.264 por hardware, mas o Chrome informa powerEfficient=false).
// Se o outro lado não aceitar H.264, a negociação cai para o próximo codec.
// Diagnóstico: localStorage 'pq.codec' = 'video/H264' | 'video/VP8' | … força o codec.

const FORCEABLE_CODECS = ['video/H264', 'video/VP8', 'video/VP9', 'video/AV1'];

export interface CodecChoice {
  mimeType: string | null;
  reason: string;
}

export async function pickVideoCodec(): Promise<CodecChoice> {
  if (typeof RTCRtpTransceiver === 'undefined' || !('setCodecPreferences' in RTCRtpTransceiver.prototype)) {
    return { mimeType: null, reason: 'padrão do navegador (sem setCodecPreferences)' };
  }
  const forced = readString('pq.codec');
  if (forced && FORCEABLE_CODECS.includes(forced)) return { mimeType: forced, reason: `forçado: ${forced.replace('video/', '')}` };
  try {
    const info = await navigator.mediaCapabilities.encodingInfo({
      type: 'webrtc',
      video: { contentType: 'video/H264', width: 1280, height: 720, bitrate: 2_500_000, framerate: 30 },
    } as MediaEncodingConfiguration);
    if (info.supported && info.powerEfficient) return { mimeType: 'video/H264', reason: 'H264 por hardware' };
  } catch { /* sem mediaCapabilities para webrtc */ }
  const h264 = RTCRtpSender.getCapabilities?.('video')?.codecs.some((c) => c.mimeType.toLowerCase() === 'video/h264');
  if (h264 && isMac()) return { mimeType: 'video/H264', reason: 'H264 (Mac: codificador por hardware)' };
  return { mimeType: null, reason: 'padrão do navegador (sem H264 por hardware)' };
}

function isMac(): boolean {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  return platform ? platform === 'macOS' : /Macintosh|Mac OS X/.test(navigator.userAgent);
}
