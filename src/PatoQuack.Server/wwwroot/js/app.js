// Orquestra a UI: microfone, sinalização, sessão de voz e lista de participantes.

import { AUDIO_CONSTRAINTS, HUB_URL, ICE_SERVERS } from './config.js';
import { MeshVoiceSession } from './mesh.js';
import { VoiceSignaling } from './signaling.js';
import { SpeakingDetector } from './speaking.js';

const LOCAL_ID = 'local';

const STATE_LABELS = {
  local: 'você',
  waiting: 'aguardando',
  new: 'conectando',
  connecting: 'conectando',
  connected: 'conectado',
  disconnected: 'instável',
  failed: 'falhou',
  closed: 'encerrado',
};

const $ = (id) => document.getElementById(id);
const ui = {
  joinView: $('join-view'),
  joinForm: $('join-form'),
  joinBtn: $('join-btn'),
  name: $('name'),
  room: $('room'),
  roomView: $('room-view'),
  roomName: $('room-name'),
  count: $('count'),
  list: $('participants'),
  muteBtn: $('mute-btn'),
  leaveBtn: $('leave-btn'),
  status: $('status'),
  log: $('log'),
  audioSink: $('remote-audio'),
};

const signaling = new VoiceSignaling(HUB_URL);

const state = {
  inRoom: false,
  room: '',
  name: '',
  muted: false,
  /** @type {MediaStream | null} */ localStream: null,
  /** @type {AudioContext | null} */ audioContext: null,
  /** @type {SpeakingDetector | null} */ speaking: null,
  /** @type {MeshVoiceSession | null} */ session: null,
  /** @type {Map<string, {name: string, muted: boolean, conn: string, speaking: boolean, audio?: HTMLAudioElement}>} */
  participants: new Map(),
};

// ---- status ---------------------------------------------------------------

function setStatus(message, level = 'info') {
  ui.status.textContent = message;
  ui.status.dataset.level = level;
  log(message, level);
}

function log(message, level = 'info') {
  const item = document.createElement('li');
  item.dataset.level = level;
  item.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  ui.log.prepend(item);
  while (ui.log.children.length > 50) ui.log.lastChild.remove();
  (level === 'error' ? console.error : console.log)(`[voz] ${message}`);
}

function errorMessage(err) {
  // HubException chega como "An unexpected error occurred invoking 'X' on the server. HubException: <msg>"
  const text = err instanceof Error ? err.message : String(err);
  const match = text.match(/HubException: (.*)$/);
  return match ? match[1] : text;
}

// ---- participantes --------------------------------------------------------

function upsertParticipant(id, patch) {
  const current = state.participants.get(id) ?? { name: '…', muted: false, conn: 'waiting', speaking: false };
  state.participants.set(id, { ...current, ...patch });
  render();
}

function removeParticipant(id) {
  const p = state.participants.get(id);
  if (!p) return;
  if (p.audio) {
    p.audio.srcObject = null;
    p.audio.remove();
  }
  state.speaking?.unwatch(id);
  state.participants.delete(id);
  render();
}

function clearRemoteParticipants() {
  for (const id of [...state.participants.keys()]) {
    if (id !== LOCAL_ID) removeParticipant(id);
  }
}

function render() {
  ui.list.replaceChildren(
    ...[...state.participants].map(([id, p]) => {
      const li = document.createElement('li');
      li.className = 'participant';
      li.classList.toggle('speaking', p.speaking && !p.muted);
      li.classList.toggle('muted', p.muted);

      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.textContent = p.name.slice(0, 1).toUpperCase();

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.dataset.state = id === LOCAL_ID ? 'local' : p.conn;
      badge.textContent = STATE_LABELS[badge.dataset.state] ?? p.conn;

      const mic = document.createElement('span');
      mic.className = 'mic';
      mic.title = p.muted ? 'Mutado' : 'Microfone aberto';
      mic.textContent = p.muted ? 'mutado' : '';

      li.append(avatar, name, mic, badge);
      return li;
    }),
  );

  ui.count.textContent = `${state.participants.size} na sala`;
  ui.muteBtn.textContent = state.muted ? 'Desmutar' : 'Mutar';
  ui.muteBtn.classList.toggle('active', state.muted);
  ui.muteBtn.setAttribute('aria-pressed', String(state.muted));
}

function attachRemoteStream(id, stream) {
  const p = state.participants.get(id);
  let audio = p?.audio;
  if (!audio) {
    audio = document.createElement('audio');
    audio.autoplay = true;
    audio.playsInline = true;
    ui.audioSink.append(audio);
  }
  audio.srcObject = stream;
  audio.play().catch(() => setStatus('O navegador bloqueou a reprodução de áudio. Clique na página para liberar.', 'warn'));

  upsertParticipant(id, { audio });
  state.speaking?.watch(id, stream);
}

// ---- eventos do servidor --------------------------------------------------

signaling.setHandlers({
  userJoined(id, name) {
    if (!state.inRoom) return;
    upsertParticipant(id, { name });
    setStatus(`${name} entrou na sala`);
    // Não criamos a conexão aqui: quem entrou é quem manda a offer.
  },
  userLeft(id) {
    const p = state.participants.get(id);
    state.session?.removePeer(id);
    removeParticipant(id);
    if (p) log(`${p.name} saiu da sala`);
  },
  userMuted(id, muted) {
    if (state.participants.has(id)) upsertParticipant(id, { muted });
  },
  receiveOffer(fromId, offer) {
    if (!state.participants.has(fromId)) upsertParticipant(fromId, {});
    state.session?.handleOffer(fromId, offer);
  },
  receiveAnswer(fromId, answer) {
    state.session?.handleAnswer(fromId, answer);
  },
  receiveIceCandidate(fromId, candidate) {
    state.session?.handleIceCandidate(fromId, candidate);
  },
});

signaling.onReconnecting(() => {
  if (!state.inRoom) return;
  setStatus('Conexão com o servidor caiu. Reconectando…', 'warn');
  // O servidor já nos tirou da sala; os outros vão fechar as conexões conosco.
  resetSession();
});

signaling.onReconnected(async () => {
  if (!state.inRoom) return;
  setStatus('Reconectado. Voltando para a sala…');
  try {
    await enterRoom();
  } catch (err) {
    setStatus(`Não foi possível voltar para a sala: ${errorMessage(err)}`, 'error');
    await leave({ notifyServer: false });
  }
});

signaling.onClose((err) => {
  if (!state.inRoom) return;
  setStatus(`Conexão com o servidor perdida${err ? `: ${err.message}` : ''}.`, 'error');
  leave({ notifyServer: false });
});

// ---- fluxo principal ------------------------------------------------------

function createSession() {
  return new MeshVoiceSession({
    signaling,
    localStream: state.localStream,
    iceServers: ICE_SERVERS,
    onPeerState(id, conn) {
      if (!state.participants.has(id)) return;
      upsertParticipant(id, { conn });
      if (conn === 'connected') log(`Áudio conectado com ${state.participants.get(id).name}`);
    },
    onRemoteStream: attachRemoteStream,
    onPeerFailed(id) {
      const name = state.participants.get(id)?.name ?? id;
      setStatus(
        `Não foi possível conectar o áudio com ${name}. Em algumas redes (NAT simétrico, firewall corporativo, 4G) é preciso um servidor TURN — configure em js/config.js.`,
        'error',
      );
    },
    onError(id, err) {
      log(`Erro de sinalização com ${state.participants.get(id)?.name ?? id}: ${errorMessage(err)}`, 'error');
    },
  });
}

/** Entra (ou reentra, após reconexão) na sala com a conexão SignalR atual. */
async function enterRoom() {
  resetSession();
  state.session = createSession();

  const existing = await signaling.joinRoom(state.room, state.name);
  for (const p of existing) {
    upsertParticipant(p.connectionId, { name: p.name, muted: p.muted });
  }
  if (state.muted) await signaling.setMuted(true);

  // Nós acabamos de entrar: somos quem manda as offers.
  await state.session.connectTo(existing.map((p) => p.connectionId));

  setStatus(existing.length === 0
    ? `Você está na sala "${state.room}". Aguardando mais alguém…`
    : `Você está na sala "${state.room}" com ${existing.length} ${existing.length === 1 ? 'pessoa' : 'pessoas'}.`);
}

async function join(event) {
  event.preventDefault();
  const name = ui.name.value.trim();
  const room = ui.room.value.trim().toLowerCase();
  if (!name || !room) return;

  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setStatus('O microfone só funciona em HTTPS ou em http://localhost. Abra a página por um desses endereços.', 'error');
    return;
  }

  // O AudioContext precisa nascer ANTES de qualquer await: o Safari só considera o clique
  // como gesto do usuário de forma síncrona. Depois do await, resume() pode ficar travado.
  const audioContext = new AudioContext();
  audioContext.resume().catch(() => {});

  setBusy(true);
  setStatus('Pedindo acesso ao microfone…');

  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
  } catch (err) {
    setBusy(false);
    audioContext.close().catch(() => {});
    const reason = err?.name === 'NotAllowedError'
      ? 'permissão negada. Libere o microfone nas configurações do site.'
      : err?.name === 'NotFoundError' ? 'nenhum microfone encontrado.' : errorMessage(err);
    setStatus(`Não foi possível usar o microfone: ${reason}`, 'error');
    return;
  }

  state.audioContext = audioContext;
  setBusy(false);
  state.speaking = new SpeakingDetector(state.audioContext, (id, speaking) => {
    if (state.participants.has(id)) upsertParticipant(id, { speaking });
  });

  state.name = name;
  state.room = room;
  state.muted = false;
  state.inRoom = true;
  remember();

  upsertParticipant(LOCAL_ID, { name, muted: false, conn: 'local' });
  state.speaking.watch(LOCAL_ID, state.localStream);

  ui.roomName.textContent = room;
  ui.joinView.hidden = true;
  ui.roomView.hidden = false;

  try {
    setStatus('Conectando ao servidor…');
    if (!signaling.isConnected) await signaling.start();
    await enterRoom();
  } catch (err) {
    setStatus(`Não foi possível entrar: ${errorMessage(err)}`, 'error');
    await leave({ notifyServer: false });
  }
}

function setBusy(busy) {
  ui.joinBtn.disabled = busy;
  ui.joinBtn.textContent = busy ? 'Entrando…' : 'Entrar na voz';
}

function resetSession() {
  state.session?.close();
  state.session = null;
  clearRemoteParticipants();
}

async function leave({ notifyServer = true } = {}) {
  const wasInRoom = state.inRoom;
  state.inRoom = false;

  if (notifyServer && signaling.isConnected) {
    try { await signaling.leaveRoom(); } catch { /* vamos desconectar de qualquer jeito */ }
  }

  resetSession();
  removeParticipant(LOCAL_ID);
  state.speaking?.stop();
  state.speaking = null;
  state.localStream?.getTracks().forEach((t) => t.stop());
  state.localStream = null;
  await state.audioContext?.close().catch(() => {});
  state.audioContext = null;

  try { await signaling.stop(); } catch { /* já estava parada */ }

  ui.roomView.hidden = true;
  ui.joinView.hidden = false;
  setBusy(false);
  if (wasInRoom && notifyServer) setStatus('Você saiu da sala.');
}

async function toggleMute() {
  if (!state.localStream) return;
  state.muted = !state.muted;
  // enabled=false manda silêncio sem renegociar a conexão.
  state.localStream.getAudioTracks().forEach((t) => { t.enabled = !state.muted; });
  upsertParticipant(LOCAL_ID, { muted: state.muted });

  try {
    await signaling.setMuted(state.muted);
  } catch (err) {
    log(`Não foi possível avisar a sala sobre o mute: ${errorMessage(err)}`, 'warn');
  }
}

// ---- preferências ---------------------------------------------------------

function remember() {
  try {
    localStorage.setItem('voz.name', state.name);
    localStorage.setItem('voz.room', state.room);
  } catch { /* storage indisponível */ }
}

function restore() {
  const params = new URLSearchParams(location.search);
  try {
    ui.name.value = localStorage.getItem('voz.name') ?? '';
    ui.room.value = params.get('sala') ?? localStorage.getItem('voz.room') ?? 'geral';
  } catch {
    ui.room.value = params.get('sala') ?? 'geral';
  }
}

ui.joinForm.onsubmit = join; // substitui o handler de segurança do index.html
ui.muteBtn.addEventListener('click', toggleMute);
ui.leaveBtn.addEventListener('click', () => leave());
window.addEventListener('pagehide', () => { if (state.inRoom) signaling.stop(); });

restore();
render();
