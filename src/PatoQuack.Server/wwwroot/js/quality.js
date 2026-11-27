// Qualidade da transmissão (resolução + FPS): constraints de captura, limite de envio e
// preferência salva por tipo (câmera / tela).

import {
  DEFAULT_VIDEO_QUALITY, HIGH_FPS, HIGH_FPS_BITRATE_FACTOR, VIDEO_FRAME_RATES, VIDEO_RESOLUTIONS,
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
  const resolution = resolutionsFor(kind).some((r) => r.id === q?.resolution) ? q.resolution : DEFAULT_VIDEO_QUALITY.resolution;
  const fps = VIDEO_FRAME_RATES.includes(Number(q?.fps)) ? Number(q.fps) : DEFAULT_VIDEO_QUALITY.fps;
  return { resolution, fps };
}

/** @returns {VideoQuality} */
export function loadQuality(kind) {
  try {
    const [resolution, fps] = (localStorage.getItem(storageKey(kind)) ?? '').split('@');
    return normalizeQuality(kind, { resolution, fps });
  } catch {
    return { ...DEFAULT_VIDEO_QUALITY };
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

/** Texto da estimativa de upload: bitrate × pessoas que recebem (todos na sala, menos você). */
export function uploadEstimate(q, viewers) {
  const per = bitrateFor(q);
  if (viewers <= 0) return `≈ ${mbps(per)} Mbps de upload para cada pessoa que entrar`;
  const who = viewers === 1 ? '1 pessoa' : `${viewers} pessoas`;
  return `≈ ${mbps(per * viewers)} Mbps de upload (${mbps(per)} Mbps × ${who})`;
}
