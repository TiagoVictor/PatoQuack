// Dispositivos de mídia (câmeras, microfones, saídas de áudio): listar, preencher <select>s e
// lembrar a escolha. Não depende do DOM do app além dos <select> recebidos.
//
// Atenção: o navegador só revela os NOMES (e, no Chrome/Safari, os ids) dos dispositivos de um
// tipo depois que a página recebeu permissão para aquele tipo. Antes disso a lista vem com
// itens sem nome; mostramos "Câmera 1", "Microfone 1"… e o app avisa o usuário.

const KIND_LABELS = {
  videoinput: 'Câmera',
  audioinput: 'Microfone',
  audiooutput: 'Saída',
};

const STORAGE_KEYS = {
  videoinput: 'voz.camera',
  audioinput: 'voz.mic',
  audiooutput: 'voz.speaker',
};

/** @param {MediaDeviceKind} kind */
export async function listDevices(kind) {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === kind);
}

/**
 * Preenche um <select> com os dispositivos do tipo e marca o selecionado.
 * @returns {Promise<{ count: number, labeled: boolean }>} labeled=false se o navegador escondeu os nomes.
 */
export async function fillDeviceSelect(select, kind, selectedId) {
  const devices = await listDevices(kind);
  const label = KIND_LABELS[kind];
  select.replaceChildren(...devices.map((d, i) => {
    const option = document.createElement('option');
    option.value = d.deviceId;
    option.textContent = d.label || `${label} ${i + 1}`;
    return option;
  }));

  if (devices.length === 0) {
    const option = document.createElement('option');
    option.textContent = `Nenhum(a) ${label.toLowerCase()} encontrado(a)`;
    option.value = '';
    select.append(option);
  }

  const ids = devices.map((d) => d.deviceId);
  select.value = selectedId && ids.includes(selectedId) ? selectedId : (ids[0] ?? '');
  select.disabled = devices.length <= 1 && !devices[0]?.deviceId;
  return { count: devices.length, labeled: devices.some((d) => d.label) };
}

/** Escolha salva (deviceId) ou null. */
export function savedDevice(kind) {
  try { return localStorage.getItem(STORAGE_KEYS[kind]) || null; } catch { return null; }
}

export function saveDevice(kind, deviceId) {
  try {
    if (deviceId) localStorage.setItem(STORAGE_KEYS[kind], deviceId);
    else localStorage.removeItem(STORAGE_KEYS[kind]);
  } catch { /* storage indisponível */ }
}

/** Restrições de getUserMedia com o dispositivo escolhido (se houver). */
export function withDevice(constraints, deviceId) {
  return deviceId ? { ...constraints, deviceId: { exact: deviceId } } : constraints;
}

/** O dispositivo escolhido não existe mais (desconectado, id trocado…)? */
export function isMissingDevice(err) {
  return err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError';
}

export function onDeviceChange(callback) {
  navigator.mediaDevices?.addEventListener?.('devicechange', callback);
}
