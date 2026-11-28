// Dispositivos de mídia (câmeras, microfones, saídas de áudio).
//
// O navegador só revela os NOMES dos dispositivos de um tipo depois que a página recebeu
// permissão para aquele tipo. Antes disso vêm sem nome: mostramos "Câmera 1", "Microfone 1"…

import { readString, writePref } from './preferences';

export interface DeviceOption {
  id: string;
  label: string;
}

const KIND_LABELS: Record<MediaDeviceKind, string> = {
  videoinput: 'Câmera',
  audioinput: 'Microfone',
  audiooutput: 'Saída',
};

const STORAGE_KEYS: Record<MediaDeviceKind, string> = {
  videoinput: 'pq.camera',
  audioinput: 'pq.mic',
  audiooutput: 'pq.speaker',
};

/** O navegador deixa a página escolher a saída de áudio? (Chrome/Edge/Firefox sim; Safari varia.) */
export const canPickSpeaker = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

export async function listDevices(kind: MediaDeviceKind): Promise<{ options: DeviceOption[]; labeled: boolean }> {
  if (!navigator.mediaDevices?.enumerateDevices) return { options: [], labeled: false };
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === kind);
  return {
    options: devices.map((d, i) => ({ id: d.deviceId, label: d.label || `${KIND_LABELS[kind]} ${i + 1}` })),
    labeled: devices.some((d) => d.label),
  };
}

/** Escolha salva (deviceId) ou null. */
export const savedDevice = (kind: MediaDeviceKind): string | null => readString(STORAGE_KEYS[kind]);

export const saveDevice = (kind: MediaDeviceKind, deviceId: string | null): void => writePref(STORAGE_KEYS[kind], deviceId);

/** Constraints de getUserMedia com o dispositivo escolhido (se houver). */
export function withDevice(constraints: MediaTrackConstraints, deviceId: string | null): MediaTrackConstraints {
  return deviceId ? { ...constraints, deviceId: { exact: deviceId } } : constraints;
}

/** O dispositivo escolhido não existe mais (desconectado, id trocado…)? */
export function isMissingDevice(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'OverconstrainedError' || name === 'NotFoundError';
}
