// Qualidade da transmissão (resolução + FPS): constraints de captura, limite de envio e
// preferência salva por tipo (câmera / tela).

import {
  DEFAULT_UPLOAD_BUDGET, DEFAULT_VIDEO_QUALITY, HIGH_FPS, HIGH_FPS_BITRATE_FACTOR, MIN_VIEWER_BITRATE,
  UPLOAD_BUDGETS, VIDEO_FRAME_RATES, VIDEO_RESOLUTIONS,
} from './config.js';

/** @typedef {{ resolution: string, fps: number }} VideoQuality */
/** @typedef {'camera' | 'screen'} StreamKind */

const storageKey = (kind) => `voz.quality.${kind}`;

/** Resoluções disponíveis para o tipo ("Original" só faz sentido na tela). */
export function resolutionsFor(kind) {
  return VIDEO_RESOLUTIONS.filter((r) => kind === 'screen' || !r.screenOnly);
}

/** Garante uma qualidade válida para o tipo (ex.: preferência antiga ou "Original" na câmera). */
export function normalizeQuality(kind, q) {
  const fallback = DEFAULT_VIDEO_QUALITY[kind];
  const resolution = resolutionsFor(kind).some((r) => r.id === q?.resolution) ? q.resolution : fallback.resolution;
  const fps = VIDEO_FRAME_RATES.includes(Number(q?.fps)) ? Number(q.fps) : fallback.fps;
  return { resolution, fps };
}

/** @returns {VideoQuality} */
export function loadQuality(kind) {
  try {
    const [resolution, fps] = (localStorage.getItem(storageKey(kind)) ?? '').split('@');
    return normalizeQuality(kind, { resolution, fps });
  } catch {
    return { ...DEFAULT_VIDEO_QUALITY[kind] };
  }
}

export function saveQuality(kind, q) {
  try { localStorage.setItem(storageKey(kind), `${q.resolution}@${q.fps}`); } catch { /* storage indisponível */ }
}

const resolutionOf = (q) => VIDEO_RESOLUTIONS.find((r) => r.id === q.resolution) ?? VIDEO_RESOLUTIONS[1];

/** Limite de envio (bps) por conexão para a qualidade. */
export function bitrateFor(q) {
  const base = resolutionOf(q).bitrate;
  return q.fps >= HIGH_FPS ? Math.round(base * HIGH_FPS_BITRATE_FACTOR) : base;
}

/**
 * Constraints de vídeo para capturar (ou aplicar com applyConstraints) na qualidade pedida.
 * Câmera: só `ideal` (um `max` que a câmera não consegue cumprir faria a captura falhar).
 * Tela: `max` (getDisplayMedia não aceita min/exact) — reduz a imagem sem distorcer.
 */
export function constraintsFor(kind, q) {
  const { height } = resolutionOf(q);
  if (kind === 'camera') {
    return { width: { ideal: Math.round((height * 16) / 9) }, height: { ideal: height }, frameRate: { ideal: q.fps } };
  }
  return { height: { max: height }, frameRate: { ideal: q.fps, max: q.fps } };
}

/** Preenche os selects de resolução e FPS com as opções do tipo e marca a qualidade atual. */
export function fillQualitySelects(resolutionSelect, fpsSelect, kind, q) {
  resolutionSelect.replaceChildren(...resolutionsFor(kind).map((r) => new Option(r.label, r.id, false, r.id === q.resolution)));
  fpsSelect.replaceChildren(...VIDEO_FRAME_RATES.map((f) => new Option(`${f} FPS`, String(f), false, f === q.fps)));
}

/** Lê a qualidade escolhida nos selects. */
export const qualityFromSelects = (resolutionSelect, fpsSelect) =>
  ({ resolution: resolutionSelect.value, fps: Number(fpsSelect.value) });

const mbps = (bps) => (bps / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/** Ex.: "1080p 60 FPS". */
export const qualityLabel = (q) => `${resolutionOf(q).label} ${q.fps} FPS`;

// ---- teto de upload (dividido entre quem assiste) ------------------------------

export function loadUploadBudget() {
  try {
    const value = Number(localStorage.getItem('voz.uploadBudget'));
    return localStorage.getItem('voz.uploadBudget') !== null && UPLOAD_BUDGETS.includes(value) ? value : DEFAULT_UPLOAD_BUDGET;
  } catch {
    return DEFAULT_UPLOAD_BUDGET;
  }
}

export function saveUploadBudget(bps) {
  try { localStorage.setItem('voz.uploadBudget', String(bps)); } catch { /* storage indisponível */ }
}

export const budgetLabel = (bps) => (bps ? `${mbps(bps)} Mbps` : 'Sem limite');

export function fillBudgetSelect(select, budget) {
  select.replaceChildren(...UPLOAD_BUDGETS.map((b) => new Option(budgetLabel(b), String(b), false, b === budget)));
}

/** Limite por pessoa: o da qualidade, reduzido para caber no teto dividido entre quem assiste. */
export function perViewerBitrate(q, viewers, budget) {
  const base = bitrateFor(q);
  if (!budget || viewers <= 0) return base;
  return Math.max(MIN_VIEWER_BITRATE, Math.min(base, Math.floor(budget / viewers)));
}

/** Texto da estimativa de upload: bitrate por pessoa × quem está assistindo, dentro do teto. */
export function uploadEstimate(q, viewers, budget) {
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
// hardware poupa muita CPU de quem transmite (medido no Mac, 4 pessoas assistindo 720p: H.264 por
// hardware ~45% de um núcleo contra ~95% do VP8). Preferimos H.264 quando o navegador informa que
// ele é eficiente (powerEfficient) OU no macOS: todo Mac tem codificador H.264 por hardware
// (VideoToolbox), mas o Chrome do Mac informa powerEfficient = false mesmo usando-o.
// Se o outro lado não aceitar H.264, a negociação cai para o próximo codec da lista.
// Diagnóstico/comparação: localStorage 'voz.codec' = 'video/H264' ou 'video/VP8' força o codec
// (recarregar a página); remover a chave volta ao automático.

const FORCEABLE_CODECS = ['video/H264', 'video/VP8', 'video/VP9', 'video/AV1'];

/** @returns {Promise<{ mimeType: string | null, reason: string }>} */
export async function pickVideoCodec() {
  if (!('setCodecPreferences' in (globalThis.RTCRtpTransceiver?.prototype ?? {}))) {
    return { mimeType: null, reason: 'padrão do navegador (sem setCodecPreferences)' };
  }
  let forced = null;
  try { forced = localStorage.getItem('voz.codec'); } catch { /* storage indisponível */ }
  if (FORCEABLE_CODECS.includes(forced)) return { mimeType: forced, reason: `forçado: ${forced.replace('video/', '')}` };
  try {
    const info = await navigator.mediaCapabilities.encodingInfo({
      type: 'webrtc',
      video: { contentType: 'video/H264', width: 1280, height: 720, bitrate: 2_500_000, framerate: 30 },
    });
    if (info.supported && info.powerEfficient) return { mimeType: 'video/H264', reason: 'H264 por hardware' };
  } catch { /* sem mediaCapabilities para webrtc */ }
  const h264 = globalThis.RTCRtpSender?.getCapabilities?.('video')?.codecs.some((c) => c.mimeType.toLowerCase() === 'video/h264');
  if (h264 && isMac()) return { mimeType: 'video/H264', reason: 'H264 (Mac: codificador por hardware)' };
  return { mimeType: null, reason: 'padrão do navegador (sem H264 por hardware)' };
}

/** macOS (Chromium informa userAgentData; Safari/Firefox, só o userAgent). iPad também se diz Mac. */
function isMac() {
  const platform = navigator.userAgentData?.platform;
  return platform ? platform === 'macOS' : /Macintosh|Mac OS X/.test(navigator.userAgent);
}
