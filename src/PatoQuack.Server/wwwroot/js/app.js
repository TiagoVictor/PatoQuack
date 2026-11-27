// Orquestra a UI: microfone, sinalização, sessão de voz, lista de participantes e palco.

import { getAuthState, logout as apiLogout } from './api.js';
import { AUDIO_CONSTRAINTS, HUB_URL, ICE_SERVERS } from './config.js';
import {
  fillDeviceSelect, isMissingDevice, onDeviceChange, saveDevice, savedDevice, withDevice,
} from './devices.js';
import { setupHoverCard } from './hovercard.js';
import { closeAllMenus, repositionMenu, setupMenus } from './menus.js';
import { MeshVoiceSession } from './mesh.js';
import { VideoPreview } from './preview-dialog.js';
import {
  bitrateFor, constraintsFor, fillBudgetSelect, fillQualitySelects, loadQuality, loadUploadBudget, normalizeQuality,
  perViewerBitrate, pickVideoCodec, qualityFromSelects, qualityLabel, saveQuality, saveUploadBudget, uploadEstimate,
} from './quality.js';
import { VoiceSignaling } from './signaling.js';
import { SpeakingDetector } from './speaking.js';
import { createStatsPanel } from './stats.js';
import { createChat } from './chat.js';
import { createServersUi } from './servers-ui.js';

const LOCAL_ID = 'local';
/** Chave do bloco da transmissão no palco (os demais blocos usam o id do participante). */
const STREAM_KEY = 'stream';
const TOAST_MS = 4000;

// Estado da conexão de cada peer. 'connected' não aparece (só o que precisa de atenção).
const STATE_LABELS = {
  waiting: 'conectando…',
  new: 'conectando…',
  connecting: 'conectando…',
  disconnected: 'instável',
  failed: 'falhou',
  closed: 'encerrado',
};

const VOICE_STATE_LABELS = {
  connecting: 'Conectando…',
  connected: 'Voz conectada',
  reconnecting: 'Reconectando…',
};

const STREAM_KINDS = {
  screen: { label: 'tela', title: 'Transmitindo tela', icon: '#i-screen' },
  camera: { label: 'câmera', title: 'Transmitindo câmera', icon: '#i-camera' },
};

const $ = (id) => document.getElementById(id);
const ui = {
  joinView: $('join-view'),
  menuLogout: $('menu-logout'),
  roomView: $('room-view'),
  callTimer: $('call-timer'),
  count: $('count'),
  list: $('participants'),
  muteBtn: $('mute-btn'),
  leaveBtn: $('leave-btn'),
  status: $('status'),
  log: $('log'),
  audioSink: $('remote-audio'),
  screenBtn: $('screen-btn'),
  cameraBtn: $('camera-btn'),
  stopStreamBtn: $('stop-stream-btn'),
  streamPanel: $('stream-panel'),
  streamPanelTitle: $('stream-panel-title'),
  streamPanelIcon: $('stream-panel-icon'),
  voiceState: $('voice-state'),
  roomAlert: $('room-alert'),
  roomAlertText: $('room-alert-text'),
  roomAlertClose: $('room-alert-close'),
  channelTitle: $('channel-title'),
  stageGrid: $('stage-grid'),
  stageStrip: $('stage-strip'),
  toast: $('toast'),
  selfAvatar: $('self-avatar'),
  selfName: $('self-name'),
  selfState: $('self-state'),
  main: document.querySelector('.main'),
  barMic: $('bar-mic'),
  barCamera: $('bar-camera'),
  barScreen: $('bar-screen'),
  barLeave: $('bar-leave'),
  pipBtn: $('pip-btn'),
  fullscreenBtn: $('fullscreen-btn'),
  streamTitle: $('stream-title'),
  streamTitleAvatar: $('stream-title-avatar'),
  streamTitleText: $('stream-title-text'),
  streamBadge: $('stream-badge'),
  streamQuality: $('stream-quality'),
  stageEmpty: $('stage-empty'),
  barCameraCaret: $('bar-camera-caret'),
  barScreenCaret: $('bar-screen-caret'),
  menuScreen: $('menu-screen'),
  menuCamera: $('menu-camera'),
  menuMore: $('menu-more'),
  menuScreenStop: $('menu-screen-stop'),
  menuScreenChange: $('menu-screen-change'),
  cameraSelect: $('camera-select'),
  cameraHint: $('camera-hint'),
  menuInvite: $('menu-invite'),
  optGrid: $('opt-grid'),
  optNonvideo: $('opt-nonvideo'),
  optStats: $('opt-stats'),
  chatToggle: $('chat-toggle'),
  chatUnread: $('chat-unread'),
  chatClose: $('chat-close'),
  optAutowatch: $('opt-autowatch'),
  optChatSound: $('opt-chat-sound'),
  stopWatchingBtn: $('stop-watching-btn'),
  streamPanelSub: $('stream-panel-sub'),
  menuMic: $('menu-mic'),
  micSelect: $('mic-select'),
  speakerField: $('speaker-field'),
  speakerSelect: $('speaker-select'),
  speakerHint: $('speaker-hint'),
  micLevel: $('mic-level'),
  outputVolume: $('output-volume'),
  outputVolumeValue: $('output-volume-value'),
  optDeafen: $('opt-deafen'),
  menuScreenSep: $('menu-screen-sep'),
  screenResolution: $('screen-resolution'),
  screenFps: $('screen-fps'),
  screenEstimate: $('screen-estimate'),
  optScreenPreview: $('opt-screen-preview'),
  cameraResolution: $('camera-resolution'),
  cameraFps: $('camera-fps'),
  cameraEstimate: $('camera-estimate'),
  optCameraPreview: $('opt-camera-preview'),
  streamCard: $('stream-card'),
  streamCardAvatar: $('stream-card-avatar'),
  streamCardName: $('stream-card-name'),
  streamCardVideo: $('stream-card-video'),
  streamCardWaiting: $('stream-card-waiting'),
  streamCardWatch: $('stream-card-watch'),
  streamCardWatchLabel: $('stream-card-watch-label'),
  streamCardSelf: $('stream-card-self'),
};

const LEVEL_SEGMENTS = 24;
/** O navegador deixa a página escolher a saída de áudio? (Chrome/Edge/Firefox sim; Safari: verificar) */
const canPickSpeaker = 'setSinkId' in HTMLMediaElement.prototype;

// Controles de qualidade dos menus ˅ da câmera e da tela.
const qualityControls = {
  camera: { resolution: ui.cameraResolution, fps: ui.cameraFps, estimate: ui.cameraEstimate, preview: ui.optCameraPreview, budget: $('camera-budget') },
  screen: { resolution: ui.screenResolution, fps: ui.screenFps, estimate: ui.screenEstimate, preview: ui.optScreenPreview, budget: $('screen-budget') },
};

// Botões que fazem a mesma coisa na doca (barra lateral) e na barra de controles do palco.
const muteButtons = [ui.muteBtn, ui.barMic];
const streamButtons = { camera: [ui.cameraBtn, ui.barCamera], screen: [ui.screenBtn, ui.barScreen] };

const signaling = new VoiceSignaling(HUB_URL);
/** Codec de vídeo preferido (H.264 se houver codificador por hardware); decidido uma vez. */
const videoCodecChoice = pickVideoCodec();
const preview = new VideoPreview({
  dialog: $('preview-dialog'),
  title: $('preview-title'),
  close: $('preview-close'),
  video: $('preview-video'),
  waiting: $('preview-waiting'),
  cameraField: $('preview-camera-field'),
  cameraSelect: $('preview-camera'),
  rechoose: $('preview-rechoose'),
  resolution: $('preview-resolution'),
  fps: $('preview-fps'),
  estimate: $('preview-estimate'),
  blocked: $('preview-blocked'),
  always: $('preview-always'),
  confirm: $('preview-confirm'),
  confirmLabel: $('preview-confirm-label'),
  budget: $('preview-budget'),
});
/** Cartão de prévia de quem transmite (criado no fim do módulo, depois do DOM pronto). */
let hoverCard = null;
const narrowScreen = window.matchMedia('(max-width: 720px)');

const state = {
  inRoom: false,
  /** Estado da voz exibido no painel. @type {'connecting' | 'connected' | 'reconnecting'} */
  voice: 'connecting',
  /** Canal de voz da chamada (id como texto, chave da sala no servidor) e nome dele. */
  room: '',
  channelName: '',
  /** Entrando num canal (botões de canal ficam desabilitados). */
  joining: false,
  /** Chat aberto no palco (os blocos viram miniaturas no topo). */
  chatMode: false,
  name: '',
  muted: false,
  /** @type {MediaStream | null} */ localStream: null,
  /** @type {AudioContext | null} */ audioContext: null,
  /** @type {SpeakingDetector | null} */ speaking: null,
  /** @type {MeshVoiceSession | null} */ session: null,
  /** @type {Map<string, {name: string, muted: boolean, conn: string, speaking: boolean, audio?: HTMLAudioElement}>} */
  participants: new Map(),
  /** Quem transmite vídeo na sala (connectionId do servidor), ou null. @type {{id: string, name: string} | null} */
  streamer: null,
  /** Nossa transmissão (tela ou câmera), se estivermos transmitindo. @type {MediaStream | null} */
  localVideo: null,
  /** O que estamos transmitindo. @type {'screen' | 'camera' | null} */
  localVideoKind: null,
  /** Pedido de transmissão em andamento (seletor de tela aberto, StartStream pendente). */
  startingStream: false,
  /** @type {{ mimeType: string | null, reason: string } | null} */
  videoCodec: null,
  /** Quem assiste: estou recebendo a transmissão de outra pessoa? (só chega vídeo se sim) */
  watching: false,
  /** Quem transmite: connectionIds de quem está assistindo (só eles recebem vídeo). */
  viewers: new Set(),
  /** Bipe quando chega mensagem de chat que não está à vista. */
  chatSound: readPref('voz.chatSound', true),
  /** Começar a assistir sozinho quando alguém transmite. */
  autoWatch: readPref('voz.autoWatch', false),
  /** Qualidade escolhida (resolução + FPS) por tipo de transmissão. */
  quality: { camera: loadQuality('camera'), screen: loadQuality('screen') },
  /** Teto de upload de vídeo (bps, 0 = sem limite), dividido entre quem assiste. */
  uploadBudget: loadUploadBudget(),
  /** Mostrar a prévia antes de transmitir, por tipo. */
  alwaysPreview: { camera: readPref('voz.preview.camera', true), screen: readPref('voz.preview.screen', true) },
  /** Track de vídeo recebido de cada peer (vazio até alguém transmitir). @type {Map<string, MediaStreamTrack>} */
  remoteVideo: new Map(),
  /** Bloco ampliado no palco (STREAM_KEY ou id de participante), ou null para a grade. @type {string | null} */
  focus: null,
  /** Mostrar blocos de quem não tem vídeo (preferência salva). */
  showNonVideo: readPref('voz.showNonVideo', true),
  /** Câmera escolhida (deviceId) ou null para a padrão. */
  cameraId: savedDevice('videoinput'),
  /** Microfone e saída de áudio escolhidos (deviceId) ou null para o padrão. */
  micId: savedDevice('audioinput'),
  speakerId: savedDevice('audiooutput'),
  /** Volume de saída (0..1) aplicado ao áudio de todos os participantes. */
  outputVolume: readNumberPref('voz.volume', 1),
  /** "Desativar áudio": não ouve ninguém e muta o microfone. */
  deafened: false,
  /** Estado do mute antes de desativar o áudio (restaurado ao reativar). */
  mutedBeforeDeafen: false,
  /** Momento da entrada na sala (para o cronômetro). */
  joinedAt: 0,
  /** @type {ReturnType<typeof setInterval> | undefined} */ timer: undefined,
  /** @type {ReturnType<typeof setTimeout> | undefined} */ toastTimer: undefined,
};

// ---- status ---------------------------------------------------------------

// A mesma mensagem vai para a tela de entrada (#status) e para a sala: informação num aviso
// flutuante (toast) no palco, aviso/erro na faixa do topo. Escrever nos dois garante que um erro
// seguido de leave() (que volta para a tela de entrada) continue visível.
function setStatus(message, level = 'info') {
  ui.status.textContent = message;
  ui.status.dataset.level = level;

  if (level === 'info') {
    showToast(message);
    ui.roomAlert.hidden = true;
  } else {
    ui.roomAlertText.textContent = message;
    ui.roomAlert.dataset.level = level;
    ui.roomAlert.hidden = false;
  }
  log(message, level);
}

// O #toast é uma região role="status" que fica sempre no DOM (só some visualmente): assim o
// leitor de tela anuncia cada texto novo.
function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.dataset.visible = 'true';
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { ui.toast.dataset.visible = 'false'; }, TOAST_MS);
}

function setVoiceState(voice) {
  state.voice = voice;
  ui.voiceState.dataset.state = voice;
  ui.voiceState.textContent = VOICE_STATE_LABELS[voice];
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

// ---- cronômetro -------------------------------------------------------------

function startTimer() {
  stopTimer();
  ui.callTimer.hidden = false;
  state.joinedAt = Date.now();
  tickTimer();
  state.timer = setInterval(tickTimer, 1000);
}

function stopTimer() {
  clearInterval(state.timer);
  state.timer = undefined;
  ui.callTimer.textContent = '';
  ui.callTimer.hidden = true;
}

function tickTimer() {
  const total = Math.floor((Date.now() - state.joinedAt) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  ui.callTimer.textContent = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  ui.callTimer.dateTime = `PT${total}S`;
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
  state.remoteVideo.delete(id);
  render();
}

function clearRemoteParticipants() {
  for (const id of [...state.participants.keys()]) {
    if (id !== LOCAL_ID) removeParticipant(id);
  }
}

// ---- helpers visuais --------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Ícone do sprite do index.html (ex.: 'i-mic-off'). */
function icon(name, label) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${name}`);
  svg.append(use);
  return svg;
}

/** Matiz estável por nome, para diferenciar avatares e blocos. */
function nameHue(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) | 0;
  return Math.abs(hash) % 360;
}

function paintAvatar(el, name) {
  el.textContent = [...name][0]?.toUpperCase() ?? '?';
  el.style.background = `hsl(${nameHue(name)} 45% 42%)`;
}

const isLocalStreamer = () => state.streamer !== null && state.streamer.id === signaling.connectionId;

/** connectionId do servidor para um id de participante (o local é guardado como LOCAL_ID). */
const serverId = (id) => (id === LOCAL_ID ? signaling.connectionId : id);

// ---- render -----------------------------------------------------------------

function render() {
  renderList();
  renderDock();
  renderStage();
  renderHeader();
}

/** Cabeçalho do palco: quem transmite + selo de qualidade/AO VIVO; e os botões de canto. */
function renderHeader() {
  const streamer = state.streamer;
  ui.streamTitle.hidden = ui.streamBadge.hidden = !streamer;
  if (streamer) {
    const local = isLocalStreamer();
    const name = local ? state.name : streamer.name;
    paintAvatar(ui.streamTitleAvatar, name);
    // O servidor não informa se a transmissão de outra pessoa é tela ou câmera.
    ui.streamTitleText.textContent = local && state.localVideoKind
      ? `Sua ${STREAM_KINDS[state.localVideoKind].label}`
      : `Transmissão de ${name}`;
  } else {
    ui.streamQuality.textContent = '';
  }

  ui.stopWatchingBtn.hidden = !isWatching();
  ui.pipBtn.hidden = !document.pictureInPictureEnabled;
  ui.pipBtn.disabled = !streamer || (!isLocalStreamer() && !state.watching);
  ui.fullscreenBtn.hidden = !(document.fullscreenEnabled || document.webkitFullscreenEnabled);
}

// ---- qualidade da transmissão (resolução e FPS exibidos) -------------------
//
// Mede o vídeo que ESTE navegador está exibindo: para quem assiste, é o que chega pela rede;
// para quem transmite, é a captura local. Conta quadros com requestVideoFrameCallback; sem
// suporte a ele, mostra só a resolução.

/** Menor janela para calcular o FPS exibido (abaixo disso, poucos quadros distorcem a conta). */
const MIN_FPS_WINDOW_MS = 500;

function startQualityMeter(video) {
  const countsFrames = 'requestVideoFrameCallback' in video;
  let frames = 0;
  let since = performance.now();

  if (countsFrames) {
    const onFrame = () => {
      frames++;
      if (video.isConnected) video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  }

  // Ao voltar para a aba, recomeça a contagem (o tempo escondido não entra na média).
  const restart = () => {
    frames = 0;
    since = performance.now();
  };
  document.addEventListener('visibilitychange', restart);

  // Atualiza uma vez por segundo (inclusive quando não chegam quadros: aí mostra 0FPS).
  const timer = setInterval(() => {
    if (!video.isConnected) {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', restart);
      return;
    }
    const now = performance.now();
    if (document.hidden) {
      // Aba escondida não desenha quadros: medir agora daria "0FPS" falso ao voltar para ela.
      frames = 0;
      since = now;
      return;
    }
    // Janela curta demais (ex.: acabou de voltar para a aba): ainda não deu tempo de chegar um
    // quadro, e a conta daria "0FPS" falso. Espera a próxima medição.
    if (now - since < MIN_FPS_WINDOW_MS) return;
    const fps = Math.round((frames * 1000) / (now - since));
    frames = 0;
    since = now;
    const res = video.videoHeight ? `${video.videoHeight}p` : '';
    ui.streamQuality.textContent = res && countsFrames ? `${res} ${fps}FPS` : res;
  }, 1000);
}

// ---- janela flutuante e tela cheia ------------------------------------------

async function togglePictureInPicture() {
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      return;
    }
    const video = tiles.get(STREAM_KEY)?.querySelector('video');
    if (video) await video.requestPictureInPicture();
  } catch (err) {
    setStatus(`Não foi possível abrir a janela flutuante: ${errorMessage(err)}`, 'warn');
  }
}

async function toggleFullscreen() {
  const current = document.fullscreenElement ?? document.webkitFullscreenElement;
  try {
    if (current) await (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
    else await (ui.main.requestFullscreen ?? ui.main.webkitRequestFullscreen).call(ui.main);
  } catch (err) {
    setStatus(`Não foi possível usar a tela cheia: ${errorMessage(err)}`, 'warn');
  }
}

function onFullscreenChange() {
  const active = (document.fullscreenElement ?? document.webkitFullscreenElement) === ui.main;
  ui.fullscreenBtn.setAttribute('aria-pressed', String(active));
  ui.fullscreenBtn.title = active ? 'Sair da tela cheia' : 'Tela cheia';
  ui.fullscreenBtn.setAttribute('aria-label', ui.fullscreenBtn.title);
}

// A lista NÃO é uma região aria-live: ela é redesenhada a cada mudança de "falando", e um
// leitor de tela anunciaria tudo de novo. Entradas e saídas são anunciadas pelo #toast.
function renderList() {
  // A lista é recriada: se o foco estava numa linha, devolve à linha nova da mesma pessoa.
  const focusedId = document.activeElement?.closest?.('#participants li[data-id]')?.dataset.id;

  ui.list.replaceChildren(
    ...[...state.participants].map(([id, p]) => {
      const isLocal = id === LOCAL_ID;
      const isStreaming = state.streamer !== null && state.streamer.id === serverId(id);

      const li = document.createElement('li');
      li.className = 'participant';
      li.dataset.id = id;
      if (isStreaming) {
        // Quem transmite tem cartão de prévia: abre ao passar o mouse, clicar ou apertar Enter.
        li.classList.add('has-card');
        li.tabIndex = 0;
        li.setAttribute('aria-haspopup', 'dialog');
        li.setAttribute('aria-expanded', String(hoverCard?.isOpenFor(id) ?? false));
        li.title = isLocal ? 'Sua transmissão' : `Ver a transmissão de ${p.name}`;
      }
      li.classList.toggle('speaking', p.speaking && !p.muted);
      li.classList.toggle('muted', p.muted);

      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.setAttribute('aria-hidden', 'true');
      paintAvatar(avatar, p.name);

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;

      li.append(avatar, name);

      if (isLocal) {
        const you = document.createElement('span');
        you.className = 'you';
        you.textContent = 'você';
        li.append(you);
      }

      if (isStreaming) {
        const live = document.createElement('span');
        live.className = 'live-badge';
        live.textContent = 'AO VIVO';
        li.append(live);
      }

      const connLabel = isLocal ? null : STATE_LABELS[p.conn];
      if (connLabel) {
        const conn = document.createElement('span');
        conn.className = 'conn';
        conn.dataset.state = p.conn;
        conn.textContent = connLabel;
        li.append(conn);
      }

      if (p.muted) li.append(icon('i-mic-off', 'mutado'));
      return li;
    }),
  );

  if (focusedId !== undefined) ui.list.querySelector(`li[data-id="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
  hoverCard?.refresh();
}

/** Painéis da barra lateral: transmissão, voz (botões) e usuário. */
function renderDock() {
  const n = state.participants.size;
  ui.count.textContent = `${state.channelName} · ${n} ${n === 1 ? 'pessoa' : 'pessoas'}`;

  paintAvatar(ui.selfAvatar, state.name || '?');
  ui.selfName.textContent = state.name;
  ui.selfState.textContent = !state.inRoom ? 'Fora da chamada'
    : state.deafened ? 'Áudio desativado' : state.muted ? 'Mutado' : 'Microfone aberto';
  for (const btn of muteButtons) {
    btn.setAttribute('aria-pressed', String(state.muted));
    btn.title = state.muted ? 'Desmutar' : 'Mutar';
  }

  const someoneElse = state.streamer !== null && !isLocalStreamer();
  for (const kind of ['camera', 'screen']) {
    const { label } = STREAM_KINDS[kind];
    const mine = state.localVideoKind === kind;
    const otherKindMine = state.localVideoKind !== null && !mine;
    const title = mine ? `Parar de transmitir a ${label}`
      : someoneElse ? `${state.streamer.name} já está transmitindo`
      : otherKindMine ? 'Pare a transmissão atual primeiro'
      : `Transmitir ${label}`;
    for (const btn of streamButtons[kind]) {
      btn.classList.toggle('on', mine);
      btn.setAttribute('aria-pressed', String(mine));
      btn.disabled = state.startingStream || otherKindMine || (someoneElse && !mine);
      btn.title = title;
      btn.setAttribute('aria-label', title);
    }
  }

  // Menu da tela: qualidade e prévia sempre; parar/alterar só enquanto você transmite a tela.
  const sharingScreen = state.localVideoKind === 'screen';
  ui.menuScreenStop.hidden = ui.menuScreenChange.hidden = ui.menuScreenSep.hidden = !sharingScreen;

  renderQuality();
  preview.setBlocked(state.streamer && !isLocalStreamer()
    ? `${state.streamer.name} começou a transmitir. Só uma transmissão por vez na sala.`
    : null);

  ui.streamPanel.hidden = state.localVideoKind === null;
  if (state.localVideoKind) {
    const kind = STREAM_KINDS[state.localVideoKind];
    ui.streamPanelTitle.textContent = kind.title;
    const n = state.viewers.size;
    ui.streamPanelSub.textContent = n === 0 ? 'Ninguém assistindo ainda' : n === 1 ? '1 pessoa assistindo' : `${n} pessoas assistindo`;
    ui.streamPanelIcon.setAttribute('href', kind.icon);
  }
}

// ---- palco ------------------------------------------------------------------
//
// Os blocos são criados uma vez e atualizados no lugar: o render roda a cada mudança de
// "falando" (várias vezes por segundo), e recriar o <video> da transmissão a cada vez faria a
// imagem piscar. Mover um elemento entre containers de forma síncrona não interrompe o vídeo.

/** @type {Map<string, HTMLButtonElement>} */
const tiles = new Map();

/** Blocos exibidos: a transmissão (se houver) e, se a opção estiver ligada, cada participante. */
function stageKeys() {
  const keys = state.streamer ? [STREAM_KEY] : [];
  return state.showNonVideo ? keys.concat([...state.participants.keys()]) : keys;
}

/** Colunas × linhas da grade para n blocos. */
function gridShape(n) {
  if (narrowScreen.matches) {
    if (n <= 1) return [1, 1];
    const cols = 2;
    return [cols, Math.ceil(n / cols)];
  }
  if (n <= 1) return [1, 1];
  if (n === 2) return [2, 1];
  if (n <= 4) return [2, 2];
  if (n <= 6) return [3, 2];
  return [3, Math.ceil(n / 3)];
}

function renderStage() {
  const keys = stageKeys();
  if (state.focus !== null && !keys.includes(state.focus)) state.focus = null;

  for (const [key, tile] of tiles) {
    if (!keys.includes(key)) {
      if (key === STREAM_KEY) {
        const video = tile.querySelector('video');
        if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
        video.srcObject = null;
      }
      tile.remove();
      tiles.delete(key);
    }
  }

  for (const key of keys) {
    let tile = tiles.get(key);
    if (!tile) {
      tile = key === STREAM_KEY ? createStreamTile() : createPersonTile(key);
      tiles.set(key, tile);
    }
    if (key === STREAM_KEY) updateStreamTile(tile);
    else updatePersonTile(tile, key);

    const focused = state.focus === key;
    tile.setAttribute('aria-pressed', String(focused));
    tile.title = focused ? 'Voltar para a grade' : 'Ampliar';
  }

  // Modo chat: o chat ocupa o palco e todos os blocos viram miniaturas no topo.
  const gridKeys = state.chatMode ? [] : state.focus !== null ? [state.focus] : keys;
  const stripKeys = state.chatMode ? keys : state.focus !== null ? keys.filter((k) => k !== state.focus) : [];
  place(ui.stageGrid, gridKeys.map((k) => tiles.get(k)));
  place(ui.stageStrip, stripKeys.map((k) => tiles.get(k)));
  ui.stageStrip.hidden = stripKeys.length === 0;

  const [cols, rows] = gridShape(gridKeys.length);
  ui.stageGrid.style.setProperty('--cols', String(cols));
  ui.stageGrid.style.setProperty('--rows', String(rows));
  ui.stageGrid.dataset.layout = state.focus !== null ? 'focus' : 'grid';
  ui.stageEmpty.hidden = keys.length > 0 || !state.inRoom || state.chatMode;
  hoverCard?.refresh(); // o botão "Assistir" do cartão depende do bloco em destaque
}

/** Deixa em `container` exatamente `els`, nesta ordem, movendo só o que mudou de lugar. */
function place(container, els) {
  els.forEach((el, i) => {
    if (container.children[i] !== el) container.insertBefore(el, container.children[i] ?? null);
  });
  for (const child of [...container.children]) {
    if (!els.includes(child)) child.remove();
  }
}

function createTile(key, className) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = `tile ${className}`;
  tile.dataset.key = key;
  tile.addEventListener('click', () => {
    // Transmissão que ainda não assistimos: o clique começa a assistir (ampliar é o próximo clique).
    if (key === STREAM_KEY && state.streamer && !isLocalStreamer() && !state.watching) {
      setWatching(true);
      return;
    }
    // Com o chat aberto, clicar numa miniatura amplia o bloco e recolhe o chat.
    if (state.chatMode) {
      setChatOpen(false, { render: false });
      state.focus = key;
    } else {
      state.focus = state.focus === key ? null : key;
    }
    renderStage();
  });
  return tile;
}

function createPersonTile(id) {
  const tile = createTile(id, 'person');
  const avatar = document.createElement('span');
  avatar.className = 'tile-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  const conn = document.createElement('span');
  conn.className = 'tile-conn';
  const label = document.createElement('span');
  label.className = 'tile-label';
  const name = document.createElement('span');
  name.className = 'tile-name';
  const mic = icon('i-mic-off');
  mic.classList.add('tile-muted');
  label.append(name, mic);
  tile.append(avatar, conn, label);
  return tile;
}

function updatePersonTile(tile, id) {
  const p = state.participants.get(id);
  const isLocal = id === LOCAL_ID;
  const hue = nameHue(p.name);
  const connLabel = isLocal ? null : STATE_LABELS[p.conn];

  tile.style.setProperty('--tile-bg', `hsl(${hue} 32% 24%)`);
  tile.classList.toggle('speaking', p.speaking && !p.muted);
  tile.classList.toggle('muted', p.muted);
  paintAvatar(tile.querySelector('.tile-avatar'), p.name);
  tile.querySelector('.tile-name').textContent = isLocal ? `${p.name} (você)` : p.name;

  const conn = tile.querySelector('.tile-conn');
  conn.hidden = !connLabel;
  conn.textContent = connLabel ?? '';
  conn.dataset.state = p.conn;

  const parts = [isLocal ? `${p.name} (você)` : p.name];
  if (p.muted) parts.push('mutado');
  if (connLabel) parts.push(connLabel);
  tile.setAttribute('aria-label', parts.join(', '));
}

function createStreamTile() {
  const tile = createTile(STREAM_KEY, 'stream-tile');
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  const live = document.createElement('span');
  live.className = 'tile-live';
  live.textContent = 'AO VIVO';
  const label = document.createElement('span');
  label.className = 'tile-label';
  const name = document.createElement('span');
  name.className = 'tile-name';
  label.append(name);
  const idle = document.createElement('span');
  idle.className = 'tile-idle';
  idle.append(icon('i-screen'), document.createTextNode('Clique para assistir'));
  tile.append(video, idle, live, label);
  startQualityMeter(video);
  return tile;
}

function updateStreamTile(tile) {
  const streamer = state.streamer;
  const local = isLocalStreamer();
  const name = local ? 'Você está transmitindo' : streamer.name;
  tile.querySelector('.tile-name').textContent = name;
  const idle = !local && !state.watching;
  tile.classList.toggle('idle', idle);
  tile.setAttribute('aria-label', local ? 'Sua transmissão, ao vivo'
    : idle ? `Transmissão de ${streamer.name}, ao vivo. Clique para assistir` : `Transmissão de ${streamer.name}, ao vivo`);
  if (idle) tile.title = 'Assistir transmissão';

  setVideoSource(tile.querySelector('video'), idle ? null : streamSource());
}

/** Vídeo da transmissão atual: quem transmite vê a própria prévia; os demais, o track recebido. */
function streamSource() {
  if (!state.streamer) return null;
  if (isLocalStreamer()) return state.localVideo;
  const remoteTrack = state.remoteVideo.get(state.streamer.id);
  return remoteTrack ? new MediaStream([remoteTrack]) : null;
}

/** Troca a fonte do <video> só se o track mudou (trocar à toa reinicia a imagem). */
function setVideoSource(video, source) {
  const current = video.srcObject;
  const sameSource = current === source
    || (current && source && current.getVideoTracks()[0] === source.getVideoTracks()[0]);
  if (!sameSource) {
    video.srcObject = source;
    if (source) video.play().catch(() => {});
  }
}

// ---- cartão de prévia de quem transmite ----------------------------------------

/** Só quem está transmitindo tem cartão. */
function hasStreamCard(id) {
  return state.streamer !== null && state.participants.has(id) && state.streamer.id === serverId(id);
}

function fillStreamCard(id) {
  const p = state.participants.get(id);
  const local = id === LOCAL_ID;
  paintAvatar(ui.streamCardAvatar, p.name);
  ui.streamCardName.textContent = local ? `${p.name} (você)` : p.name;

  // Quem não assiste não recebe vídeo: a prévia só existe para quem já assiste (ou transmite).
  const receives = local || state.watching;
  const source = receives ? streamSource() : null;
  setVideoSource(ui.streamCardVideo, source);
  ui.streamCardWaiting.hidden = source !== null;
  ui.streamCardWaiting.textContent = receives ? 'Conectando vídeo…' : 'Clique em Assistir para ver';

  const enlarged = state.watching && state.focus === STREAM_KEY;
  ui.streamCardWatch.hidden = local;
  ui.streamCardWatch.disabled = enlarged;
  ui.streamCardWatchLabel.textContent = enlarged ? 'Assistindo' : 'Assistir transmissão';
  ui.streamCardSelf.hidden = !local;
}

/** "Assistir transmissão" do cartão: começa a receber e amplia no palco. */
function watchStream() {
  hoverCard.hide();
  if (!state.streamer) return;
  setWatching(true);
  if (state.chatMode) setChatOpen(false, { render: false });
  state.focus = STREAM_KEY;
  renderStage();
  const tile = tiles.get(STREAM_KEY);
  if (!tile) return;
  tile.focus({ preventScroll: true });
  // Na tela estreita o palco fica abaixo da lista.
  if (narrowScreen.matches) ui.main.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- transmissão de vídeo -------------------------------------------------

function setStreamer(streamer) {
  const changed = state.streamer?.id !== streamer?.id;
  state.streamer = streamer;
  if (changed) {
    // Transmissão nova (ou nenhuma): ninguém está assistindo até escolher de novo.
    state.watching = false;
    state.viewers.clear();
  }
  render(); // lista (selo AO VIVO), botões e palco
  if (changed && streamer && !isLocalStreamer() && state.autoWatch) setWatching(true);
}

/** Estou assistindo a transmissão de outra pessoa? */
const isWatching = () => state.streamer !== null && !isLocalStreamer() && state.watching;

/**
 * Começa/para de assistir a transmissão de outra pessoa. Quem transmite só envia (e codifica)
 * vídeo para quem avisou que está assistindo.
 */
async function setWatching(watching) {
  if (!state.streamer || isLocalStreamer() || state.watching === watching) return;
  state.watching = watching;
  if (!watching) {
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    if (state.focus === STREAM_KEY) state.focus = null;
  }
  render();
  try {
    await signaling.watchStream(watching);
  } catch (err) {
    setStatus(`Não foi possível ${watching ? 'começar a assistir' : 'parar de assistir'}: ${errorMessage(err)}`, 'warn');
  }
}

function setAutoWatch(on) {
  state.autoWatch = on;
  writePref('voz.autoWatch', on);
  if (on) setWatching(true);
}

function onRemoteVideo(id, track) {
  state.remoteVideo.set(id, track);
  if (state.streamer?.id === id) renderStage();
}

/** Botões de câmera/tela: ligam a transmissão daquele tipo ou, se já é a nossa, desligam. */
function toggleStream(kind) {
  if (state.localVideoKind === kind) stopStream();
  else startStream(kind);
}

/** @param {'screen' | 'camera'} kind */
async function startStream(kind) {
  if (!state.session || state.localVideo || state.startingStream) return;
  if (state.streamer && !isLocalStreamer()) {
    setStatus(`${state.streamer.name} já está transmitindo.`, 'warn');
    return;
  }

  state.startingStream = true;
  renderDock();
  let media;
  try {
    // Pede a mídia primeiro (o seletor precisa do clique); só depois reserva a vez no servidor,
    // para não avisar a sala de uma transmissão que o usuário cancelou no seletor.
    media = await captureVideo(kind);
  } catch (err) {
    state.startingStream = false;
    renderDock();
    if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') {
      setStatus(`Não foi possível capturar ${kind === 'screen' ? 'a tela' : 'a câmera'}: ${errorMessage(err)}`, 'error');
    }
    return;
  }

  if (state.alwaysPreview[kind]) {
    media = await previewCapture(kind, media);
    if (!media) {
      // Cancelou a prévia (ou saiu da sala com ela aberta): nada foi enviado à sala.
      state.startingStream = false;
      renderDock();
      return;
    }
    if (!state.inRoom || !state.session || (state.streamer && !isLocalStreamer())) {
      media.getTracks().forEach((t) => t.stop());
      state.startingStream = false;
      renderDock();
      return;
    }
  }

  const [track] = media.getVideoTracks();
  track.contentHint = kind === 'screen' ? 'detail' : 'motion';

  try {
    await signaling.startStream();
  } catch (err) {
    media.getTracks().forEach((t) => t.stop());
    state.startingStream = false;
    renderDock();
    setStatus(`Não foi possível transmitir: ${errorMessage(err)}`, 'error');
    return;
  }

  state.startingStream = false;
  if (!state.inRoom || !state.session) {
    // Saímos da sala enquanto o servidor respondia.
    media.getTracks().forEach((t) => t.stop());
    return;
  }

  state.localVideo = media;
  state.localVideoKind = kind;
  // "Parar compartilhamento" na barra do navegador (ou a câmera desconectada) também encerra.
  track.onended = () => stopStream();
  // StreamStarted também chega para nós; marcamos já para a prévia aparecer sem esperar.
  setStreamer({ id: signaling.connectionId, name: state.name });
  await applyStreamBitrate();
  await state.session.setVideoTrack(track);
  setStatus(`Você está transmitindo ${kind === 'screen' ? 'a tela' : 'a câmera'}.`);
}

async function stopStream({ notifyServer = true } = {}) {
  const media = state.localVideo;
  if (!media) return;
  state.localVideo = null;
  state.localVideoKind = null;

  for (const t of media.getTracks()) {
    t.onended = null;
    t.stop();
  }
  await state.session?.setVideoTrack(null);
  // Próxima transmissão começa sem ninguém assistindo (cada pessoa escolhe de novo).
  await state.session?.clearVideoViewers();
  state.viewers.clear();
  if (isLocalStreamer()) setStreamer(null);
  else render();

  if (notifyServer && signaling.isConnected) {
    try {
      await signaling.stopStream();
    } catch (err) {
      log(`Não foi possível avisar a sala do fim da transmissão: ${errorMessage(err)}`, 'warn');
    }
  }
}

/** Captura a tela (seletor do navegador) ou a câmera escolhida. */
async function captureVideo(kind) {
  const constraints = constraintsFor(kind, state.quality[kind]);
  if (kind === 'screen') {
    return navigator.mediaDevices.getDisplayMedia({ video: constraints, audio: false });
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ video: withDevice(constraints, state.cameraId), audio: false });
  } catch (err) {
    if (!state.cameraId || !isMissingDevice(err)) throw err;
    // A câmera escolhida foi desconectada (ou o id mudou): volta para a padrão.
    setStatus('A câmera escolhida não está disponível. Usando a câmera padrão.', 'warn');
    state.cameraId = null;
    saveDevice('videoinput', null);
    return navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
  }
}

/** Mostra a prévia da captura; resolve com a mídia a transmitir, ou null se cancelou. */
async function previewCapture(kind, media) {
  const result = await preview.open({
    kind,
    media,
    quality: state.quality[kind],
    alwaysPreview: state.alwaysPreview[kind],
    recapture: () => captureVideo(kind),
    fillCameras: async (select, current) => {
      const id = current.getVideoTracks()[0]?.getSettings().deviceId ?? state.cameraId;
      await fillDeviceSelect(select, 'videoinput', id); // com permissão, os nomes já aparecem
    },
    onCameraChange: (deviceId) => {
      state.cameraId = deviceId || null;
      saveDevice('videoinput', state.cameraId);
    },
    estimate: (q) => uploadEstimate(q, 0, state.uploadBudget), // ninguém assiste antes de começar
    budget: state.uploadBudget,
    onBudgetChange: (bps) => setUploadBudget(bps),
    onQualityChange: (q) => setQualityPref(kind, q),
    onAlwaysChange: (always) => setAlwaysPreview(kind, always),
    onError: (message) => setStatus(message, 'warn'),
  });
  return result?.media ?? null;
}

/**
 * Troca o vídeo de uma transmissão em andamento (outra tela, outra câmera) sem avisar o servidor
 * nem renegociar: é o mesmo replaceTrack usado para começar/parar.
 */
async function replaceLocalVideo(media, kind) {
  const old = state.localVideo;
  const [track] = media.getVideoTracks();
  track.contentHint = kind === 'screen' ? 'detail' : 'motion';
  track.onended = () => stopStream();

  state.localVideo = media;
  state.localVideoKind = kind;
  await state.session?.setVideoTrack(track);
  for (const t of old?.getTracks() ?? []) {
    t.onended = null;
    t.stop();
  }
  render();
}

/** "Alterar a transmissão": abre o seletor de novo e troca a tela sem parar a transmissão. */
async function changeScreen() {
  closeAllMenus();
  if (state.localVideoKind !== 'screen') return;
  let media;
  try {
    media = await captureVideo('screen');
  } catch (err) {
    if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') {
      setStatus(`Não foi possível trocar a tela: ${errorMessage(err)}`, 'error');
    }
    return; // cancelou o seletor: segue transmitindo a tela anterior
  }
  if (state.localVideoKind !== 'screen') {
    // A transmissão acabou enquanto o seletor estava aberto.
    media.getTracks().forEach((t) => t.stop());
    return;
  }
  await replaceLocalVideo(media, 'screen');
  setStatus('Transmissão alterada.');
}

/** Câmera escolhida no menu. Se já estamos transmitindo a câmera, troca na hora. */
async function selectCamera(deviceId) {
  state.cameraId = deviceId || null;
  saveDevice('videoinput', state.cameraId);
  if (state.localVideoKind !== 'camera') return;
  try {
    let media;
    try {
      media = await captureVideo('camera');
    } catch (err) {
      // Em muitos celulares só uma câmera pode ficar aberta: solta a atual e tenta de novo
      // (quem assiste vê a imagem congelar por um instante).
      if (err?.name !== 'NotReadableError') throw err;
      state.localVideo?.getVideoTracks().forEach((t) => { t.onended = null; t.stop(); });
      media = await captureVideo('camera');
    }
    if (state.localVideoKind !== 'camera') {
      media.getTracks().forEach((t) => t.stop());
      return;
    }
    await replaceLocalVideo(media, 'camera');
    setStatus('Câmera trocada.');
  } catch (err) {
    setStatus(`Não foi possível trocar a câmera: ${errorMessage(err)}`, 'error');
    // Se a câmera anterior já foi solta, não há mais o que transmitir: encerra de vez.
    if (state.localVideo?.getVideoTracks().every((t) => t.readyState === 'ended')) await stopStream();
  }
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
  // Preferências de áudio valem também para quem entra depois.
  audio.volume = state.outputVolume;
  audio.muted = state.deafened;
  if (canPickSpeaker && state.speakerId) {
    audio.setSinkId(state.speakerId).catch(() => log('Saída de áudio escolhida indisponível; usando a padrão.', 'warn'));
  }
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
    chat.system(`${name} entrou na sala`);
    // Não criamos a conexão aqui: quem entrou é quem manda a offer.
  },
  userLeft(id) {
    const p = state.participants.get(id);
    if (state.viewers.delete(id)) {
      applyStreamBitrate();
      renderDock();
    }
    state.session?.setPeerVideoEnabled(id, false);
    if (state.streamer?.id === id) setStreamer(null);
    state.session?.removePeer(id);
    removeParticipant(id);
    chat.forget(id);
    if (p) {
      setStatus(`${p.name} saiu da sala`);
      chat.system(`${p.name} saiu da sala`);
    }
  },
  userMuted(id, muted) {
    if (state.participants.has(id)) upsertParticipant(id, { muted });
  },
  streamStarted(id, name) {
    if (!state.inRoom) return;
    setStreamer({ id, name });
    if (id !== signaling.connectionId) {
      setStatus(`${name} começou a transmitir`);
      chat.system(`${name} começou a transmitir`);
    }
  },
  chatMessage(message) {
    if (state.inRoom) chat.onMessage(message);
  },
  /** O servidor nos tirou da chamada (saímos do servidor, ele foi apagado…). */
  kicked(reason) {
    leave({ notifyServer: false, quiet: true }).then(async () => {
      setStatus(reason, 'warn');
      try { await serversUi.load(); } catch { /* a lista atualiza no próximo carregamento */ }
    });
  },
  userTyping(id) {
    if (state.inRoom) chat.onTyping(id);
  },
  viewerChanged(id, watching) {
    if (!isLocalStreamer()) return; // a transmissão acabou no caminho
    if (watching) state.viewers.add(id);
    else state.viewers.delete(id);
    state.session?.setPeerVideoEnabled(id, watching);
    applyStreamBitrate(); // o teto de upload é dividido entre quem assiste
    renderDock();
  },
  streamStopped(id) {
    if (state.streamer?.id !== id) return;
    const { name } = state.streamer;
    setStreamer(null);
    if (id !== signaling.connectionId) {
      log(`${name} parou de transmitir`);
      chat.system(`${name} parou de transmitir`);
    }
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
  setVoiceState('reconnecting');
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
    onRemoteVideo,
    videoMaxBitrate: bitrateFor(state.quality.camera), // trocado ao começar cada transmissão
    preferredVideoCodec: state.videoCodec?.mimeType ?? null,
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
  setVoiceState('connecting');
  state.videoCodec = await videoCodecChoice;
  log(`Codec de vídeo: ${state.videoCodec.reason}`);
  state.session = createSession();

  const { participants: existing, streamer } = await signaling.joinRoom(Number(state.room));
  // StreamStarted pode ter chegado antes da resposta; a resposta é o retrato no momento da entrada.
  if (streamer && !state.streamer) setStreamer({ id: streamer.connectionId, name: streamer.name });
  for (const p of existing) {
    upsertParticipant(p.connectionId, { name: p.name, muted: p.muted });
  }
  if (state.muted) await signaling.setMuted(true);

  // Nós acabamos de entrar: somos quem manda as offers.
  await state.session.connectTo(existing.map((p) => p.connectionId));

  setVoiceState('connected');
  chat.start(state.channelName); // histórico do canal (não segura a entrada: erros aparecem no chat)
  setStatus(existing.length === 0
    ? `Você está em ${state.channelName}. Aguardando mais alguém…`
    : `Você está em ${state.channelName} com ${existing.length} ${existing.length === 1 ? 'pessoa' : 'pessoas'}.`);
}

/** Clique num canal de voz: entra na chamada (saindo antes de outro canal, se estiver em um). */
async function join(server, channel) {
  const name = state.name; // vem da conta (o servidor também usa a da sessão)
  if (!name || !channel || state.joining) return;
  if (state.inRoom) await leave({ quiet: true });

  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setStatus('O microfone só funciona em HTTPS ou em http://localhost. Abra a página por um desses endereços.', 'error');
    return;
  }

  // O AudioContext precisa nascer ANTES de qualquer await: o Safari só considera o clique
  // como gesto do usuário de forma síncrona. Depois do await, resume() pode ficar travado.
  const audioContext = new AudioContext();
  audioContext.resume().catch(() => {});

  setJoining(true);
  setStatus('Pedindo acesso ao microfone…');

  try {
    state.localStream = await captureMic();
    watchMicEnded(state.localStream);
  } catch (err) {
    setJoining(false);
    audioContext.close().catch(() => {});
    const reason = err?.name === 'NotAllowedError'
      ? 'permissão negada. Libere o microfone nas configurações do site.'
      : err?.name === 'NotFoundError' ? 'nenhum microfone encontrado.' : errorMessage(err);
    setStatus(`Não foi possível usar o microfone: ${reason}`, 'error');
    return;
  }

  state.audioContext = audioContext;
  state.speaking = new SpeakingDetector(state.audioContext, (id, speaking) => {
    if (state.participants.has(id)) upsertParticipant(id, { speaking });
  });

  state.name = name;
  state.room = String(channel.id);
  state.channelName = channel.name;
  state.muted = false;
  state.focus = null;
  state.inRoom = true;

  upsertParticipant(LOCAL_ID, { name, muted: false, conn: 'local' });
  state.speaking.watch(LOCAL_ID, state.localStream);

  ui.channelTitle.textContent = channel.name;
  ui.roomAlert.hidden = true;
  ui.roomView.classList.remove('idle');
  setVoiceState('connecting');
  startTimer();
  renderChannels();

  try {
    setStatus('Conectando ao servidor…');
    if (!signaling.isConnected) await signaling.start();
    await enterRoom();
    setJoining(false);
  } catch (err) {
    setJoining(false);
    // Sessão vencida (o hub exige login): volta para a tela de entrar.
    if (/\b401\b|Unauthorized/.test(String(err?.message ?? err))) {
      location.replace(`/auth.html?modo=entrar&servidor=${server.id}`);
      return;
    }
    const message = `Não foi possível entrar: ${errorMessage(err)}`;
    await leave({ notifyServer: false, quiet: true });
    setStatus(message, 'error');
  }
}

function setJoining(joining) {
  state.joining = joining;
  renderChannels();
}

/** Lista de canais + cronômetro e participantes debaixo do canal da chamada. */
function renderChannels() {
  serversUi?.renderChannels();
}

function placeChannelExtras() {
  const li = state.inRoom ? document.querySelector(`#channel-list li[data-channel-id="${state.room}"]`) : null;
  if (li) {
    li.querySelector('.channel-btn')?.append(ui.callTimer);
    li.append(ui.list);
  } else {
    document.querySelector('.channels').append(ui.callTimer, ui.list);
  }
}

function resetSession() {
  // O servidor encerra a transmissão sozinho quando saímos ou caímos; aqui só soltamos a captura.
  stopStream({ notifyServer: false });
  state.session?.close();
  state.session = null;
  state.streamer = null;
  state.watching = false;
  state.viewers.clear();
  state.remoteVideo.clear();
  clearRemoteParticipants();
  render();
}

async function leave({ notifyServer = true, quiet = false } = {}) {
  const wasInRoom = state.inRoom;
  state.inRoom = false;
  preview.cancel(); // prévia aberta: encerra a captura sem transmitir
  stats.hide();
  chat.reset();
  setChatOpen(false); // a próxima chamada começa em grade
  closeAllMenus();
  stopLevelMeter();
  state.deafened = false;
  ui.optDeafen.checked = false;

  if (notifyServer && signaling.isConnected) {
    try { await signaling.leaveRoom(); } catch { /* vamos desconectar de qualquer jeito */ }
  }

  resetSession();
  removeParticipant(LOCAL_ID);
  stopTimer();
  state.speaking?.stop();
  state.speaking = null;
  state.localStream?.getTracks().forEach((t) => t.stop());
  state.localStream = null;
  await state.audioContext?.close().catch(() => {});
  state.audioContext = null;

  try { await signaling.stop(); } catch { /* já estava parada */ }

  // Em tela cheia, a área da sala continuaria ocupando a tela depois de escondida.
  if ((document.fullscreenElement ?? document.webkitFullscreenElement) === ui.main) {
    try {
      await (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
    } catch { /* já saiu */ }
  }

  // Fora da chamada: continua no servidor, com a lista de canais.
  state.room = '';
  ui.roomView.classList.add('idle');
  ui.channelTitle.textContent = serversUi?.current?.name ?? '';
  renderChannels();
  if (wasInRoom && notifyServer && !quiet) setStatus('Você saiu do canal.');
}

/** Botão de mute. Com o áudio desativado, desmutar também reativa o áudio (como no Discord). */
async function toggleMute() {
  if (!state.localStream) return;
  if (state.deafened) {
    await setDeafened(false, { restoreMute: false });
    await setMuted(false);
  } else {
    await setMuted(!state.muted);
  }
}

async function setMuted(muted) {
  if (!state.localStream || state.muted === muted) return;
  state.muted = muted;
  // enabled=false manda silêncio sem renegociar a conexão.
  state.localStream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
  upsertParticipant(LOCAL_ID, { muted });

  try {
    await signaling.setMuted(muted);
  } catch (err) {
    log(`Não foi possível avisar a sala sobre o mute: ${errorMessage(err)}`, 'warn');
  }
}

/**
 * "Desativar áudio": silencia o áudio de todos e muta o microfone. Só local: a sala vê você como
 * "mutado" (pelo aviso de mute que já existe), não como "áudio desativado".
 */
async function setDeafened(deafened, { restoreMute = true } = {}) {
  if (state.deafened === deafened) return;
  state.deafened = deafened;
  for (const p of state.participants.values()) {
    if (p.audio) p.audio.muted = deafened;
  }
  ui.optDeafen.checked = deafened;
  if (deafened) {
    state.mutedBeforeDeafen = state.muted;
    await setMuted(true);
  } else if (restoreMute) {
    await setMuted(state.mutedBeforeDeafen);
  }
  render();
  setStatus(deafened ? 'Áudio desativado: você não ouve ninguém e está mutado.' : 'Áudio reativado.');
}

// ---- dispositivos de áudio ----------------------------------------------------

/** Abre o microfone escolhido; se ele não existir mais, usa o padrão. */
async function captureMic() {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: withDevice(AUDIO_CONSTRAINTS, state.micId), video: false });
  } catch (err) {
    if (!state.micId || !isMissingDevice(err)) throw err;
    log('O microfone escolhido não está disponível; usando o padrão.', 'warn');
    state.micId = null;
    saveDevice('audioinput', null);
    return navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
  }
}

/** Microfone desconectado no meio da chamada (ex.: fone Bluetooth desligou): volta para o padrão. */
function watchMicEnded(stream) {
  for (const track of stream.getAudioTracks()) {
    track.onended = () => {
      if (!state.inRoom || state.localStream !== stream) return;
      setStatus('O microfone foi desconectado. Tentando o microfone padrão…', 'warn');
      switchMic(null, { announce: false });
    };
  }
}

/** Troca o microfone durante a chamada (sem renegociar), mantendo mute e indicador de fala. */
async function switchMic(deviceId, { announce = true } = {}) {
  state.micId = deviceId || null;
  saveDevice('audioinput', state.micId);
  if (!state.localStream) return;

  let stream;
  try {
    stream = await captureMic();
  } catch (err) {
    setStatus(`Não foi possível usar esse microfone: ${errorMessage(err)}`, 'error');
    if (ui.menuMic.matches(':popover-open')) refreshMicMenu();
    return;
  }
  if (!state.inRoom || !state.localStream) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }

  const old = state.localStream;
  stream.getAudioTracks().forEach((t) => { t.enabled = !state.muted; });
  watchMicEnded(stream);
  state.localStream = stream;
  await state.session?.replaceAudioTrack(stream);
  state.speaking?.watch(LOCAL_ID, stream);
  for (const t of old.getTracks()) {
    t.onended = null;
    t.stop();
  }
  if (ui.menuMic.matches(':popover-open')) startLevelMeter();

  const label = stream.getAudioTracks()[0]?.label;
  if (announce) setStatus(label ? `Microfone: ${label}` : 'Microfone trocado.');
  else setStatus(label ? `Usando o microfone: ${label}` : 'Usando o microfone padrão.');
}

async function selectSpeaker(deviceId) {
  state.speakerId = deviceId || null;
  saveDevice('audiooutput', state.speakerId);
  const results = await Promise.allSettled([...state.participants.values()]
    .filter((p) => p.audio)
    .map((p) => p.audio.setSinkId(state.speakerId ?? '')));
  if (results.some((r) => r.status === 'rejected')) {
    setStatus('Não foi possível usar essa saída de áudio.', 'error');
  }
}

function setOutputVolume(volume) {
  state.outputVolume = volume;
  writePref('voz.volume', volume);
  for (const p of state.participants.values()) {
    if (p.audio) p.audio.volume = volume;
  }
  ui.outputVolumeValue.textContent = `${Math.round(volume * 100)}%`;
}

async function refreshMicMenu() {
  const currentMic = state.localStream?.getAudioTracks()[0]?.getSettings().deviceId;
  await fillDeviceSelect(ui.micSelect, 'audioinput', currentMic ?? state.micId);
  ui.speakerField.hidden = !canPickSpeaker;
  ui.speakerHint.hidden = canPickSpeaker;
  if (canPickSpeaker) await fillDeviceSelect(ui.speakerSelect, 'audiooutput', state.speakerId ?? 'default');
  ui.outputVolume.value = String(Math.round(state.outputVolume * 100));
  ui.outputVolumeValue.textContent = `${Math.round(state.outputVolume * 100)}%`;
  ui.optDeafen.checked = state.deafened;
  repositionMenu(ui.menuMic);
}

// ---- medidor de nível do microfone (só com o painel aberto) --------------------

const levelMeter = { source: null, analyser: null, buffer: null, raf: 0 };

function buildLevelMeter() {
  ui.micLevel.replaceChildren(...Array.from({ length: LEVEL_SEGMENTS }, () => document.createElement('span')));
}

function startLevelMeter() {
  stopLevelMeter();
  if (!state.audioContext || !state.localStream) return;
  const source = state.audioContext.createMediaStreamSource(state.localStream);
  const analyser = state.audioContext.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  Object.assign(levelMeter, { source, analyser, buffer: new Float32Array(analyser.fftSize) });

  const segments = [...ui.micLevel.children];
  const tick = () => {
    analyser.getFloatTimeDomainData(levelMeter.buffer);
    let sum = 0;
    for (const s of levelMeter.buffer) sum += s * s;
    const rms = Math.sqrt(sum / levelMeter.buffer.length);
    // Escala em dB (-60 dB = vazio, 0 dB = cheio), como os medidores de áudio costumam mostrar.
    const level = rms > 0 ? Math.min(1, Math.max(0, (20 * Math.log10(rms) + 60) / 60)) : 0;
    const lit = Math.round(level * LEVEL_SEGMENTS);
    segments.forEach((seg, i) => seg.classList.toggle('on', i < lit));
    ui.micLevel.setAttribute('aria-valuenow', String(Math.round(level * 100)));
    levelMeter.raf = requestAnimationFrame(tick);
  };
  tick();
}

function stopLevelMeter() {
  cancelAnimationFrame(levelMeter.raf);
  levelMeter.source?.disconnect();
  Object.assign(levelMeter, { source: null, analyser: null, buffer: null, raf: 0 });
  for (const seg of ui.micLevel.children) seg.classList.remove('on');
  ui.micLevel.setAttribute('aria-valuenow', '0');
}

// ---- painéis (popovers) -----------------------------------------------------

/** Preenche o painel que está abrindo com o estado atual. */
async function onMenuOpen(menu) {
  if (menu === ui.menuMore) {
    ui.optGrid.checked = state.focus === null;
    ui.optNonvideo.checked = state.showNonVideo;
    ui.optStats.checked = stats.isOpen;
    ui.optAutowatch.checked = state.autoWatch;
    ui.optChatSound.checked = state.chatSound;
  } else if (menu === ui.menuCamera) {
    syncQualityControls('camera');
    await refreshCameraList();
  } else if (menu === ui.menuScreen) {
    syncQualityControls('screen');
  } else if (menu === ui.menuMic) {
    startLevelMeter();
    await refreshMicMenu();
  }
}

function onMenuClose(menu) {
  if (menu === ui.menuMic) stopLevelMeter();
}

async function refreshCameraList() {
  const current = state.localVideoKind === 'camera'
    ? state.localVideo?.getVideoTracks()[0]?.getSettings().deviceId
    : null;
  const { labeled } = await fillDeviceSelect(ui.cameraSelect, 'videoinput', current ?? state.cameraId);
  ui.cameraHint.hidden = labeled;
  repositionMenu(ui.menuCamera);
}

function setGridView(grid) {
  if (state.chatMode) setChatOpen(false, { render: false });
  if (grid) {
    state.focus = null;
  } else {
    // Sem grade = um bloco em destaque: a transmissão, se houver; senão outra pessoa.
    const keys = stageKeys();
    state.focus = keys.includes(STREAM_KEY) ? STREAM_KEY : keys.find((k) => k !== LOCAL_ID) ?? keys[0] ?? null;
  }
  renderStage();
  ui.optGrid.checked = state.focus === null; // nada para destacar → continua em grade
}

function setShowNonVideo(show) {
  state.showNonVideo = show;
  writePref('voz.showNonVideo', show);
  renderStage();
  ui.optGrid.checked = state.focus === null;
}

/** ⋯ → Convidar pessoas: abre a janela de convite do servidor atual. */
function copyInvite() {
  closeAllMenus();
  serversUi.openInvite();
}

async function signOut() {
  closeAllMenus();
  if (state.inRoom) await leave();
  try { await apiLogout(); } catch { /* a sessão some do mesmo jeito ao recarregar */ }
  location.replace('/auth.html?modo=entrar');
}

// ---- qualidade e prévia ---------------------------------------------------

/** Preenche os selects e a caixa de prévia do menu do tipo com o estado atual. */
function syncQualityControls(kind) {
  const c = qualityControls[kind];
  fillQualitySelects(c.resolution, c.fps, kind, state.quality[kind]);
  fillBudgetSelect(c.budget, state.uploadBudget);
  c.preview.checked = state.alwaysPreview[kind];
  renderQuality();
}

/** Estimativa de upload nos menus (muda com a qualidade, o teto e quantas pessoas assistem). */
function renderQuality() {
  for (const kind of ['camera', 'screen']) {
    const viewers = state.localVideoKind === kind ? state.viewers.size : 0;
    qualityControls[kind].estimate.textContent = uploadEstimate(state.quality[kind], viewers, state.uploadBudget);
  }
  preview.refresh();
}

/**
 * Limite de envio por pessoa da transmissão no ar: o da qualidade, dividido pelo teto de upload
 * entre quem está assistindo. Recalculado quando alguém começa/para de assistir.
 */
async function applyStreamBitrate() {
  const kind = state.localVideoKind;
  if (!kind || !state.session) return;
  await state.session.setVideoMaxBitrate(perViewerBitrate(state.quality[kind], state.viewers.size, state.uploadBudget));
}

async function setUploadBudget(bps) {
  state.uploadBudget = bps;
  saveUploadBudget(bps);
  for (const kind of ['camera', 'screen']) fillBudgetSelect(qualityControls[kind].budget, bps);
  renderQuality();
  await applyStreamBitrate();
}

function setQualityPref(kind, q) {
  state.quality[kind] = normalizeQuality(kind, q);
  saveQuality(kind, state.quality[kind]);
  renderQuality();
}

/**
 * Qualidade escolhida no menu. Se esse tipo está no ar, aplica na hora: novo teto de captura
 * (applyConstraints, sem recapturar) e novo limite de envio em todas as conexões.
 */
async function changeQuality(kind, q) {
  setQualityPref(kind, q);
  const quality = state.quality[kind];
  if (state.localVideoKind !== kind || !state.localVideo) return;
  const [track] = state.localVideo.getVideoTracks();
  try {
    await track.applyConstraints(constraintsFor(kind, quality));
  } catch (err) {
    setStatus(`Não foi possível aplicar ${qualityLabel(quality)}: ${errorMessage(err)}`, 'warn');
    return;
  }
  await applyStreamBitrate();
  setStatus(`Qualidade da ${STREAM_KINDS[kind].label}: ${qualityLabel(quality)}.`);
}

function setAlwaysPreview(kind, always) {
  state.alwaysPreview[kind] = always;
  writePref(`voz.preview.${kind}`, always);
  qualityControls[kind].preview.checked = always;
}

// ---- preferências ---------------------------------------------------------

function readPref(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* storage indisponível */ }
}

function readNumberPref(key, fallback) {
  try {
    const value = Number.parseFloat(localStorage.getItem(key) ?? '');
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
  } catch {
    return fallback;
  }
}

/** Sem sessão, vai para a tela de conta (preservando a sala do link). */
async function boot() {
  let auth;
  try {
    auth = await getAuthState();
  } catch (err) {
    setStatus(err.message, 'error');
    return;
  }
  const params = new URLSearchParams(location.search);
  if (!auth.user) {
    const q = new URLSearchParams({ modo: auth.setupRequired ? 'configurar' : 'entrar' });
    if (params.get('servidor')) q.set('servidor', params.get('servidor'));
    location.replace(`/auth.html?${q}`);
    return;
  }
  state.name = auth.user.displayName;
  renderDock();
  ui.joinView.hidden = true;
  ui.roomView.hidden = false;
  let saved = null;
  try { saved = localStorage.getItem('voz.server'); } catch { /* sem storage */ }
  try {
    await serversUi.load(params.get('servidor') ?? saved);
  } catch (err) {
    setStatus(`Não foi possível carregar seus servidores: ${errorMessage(err)}`, 'error');
  }
}

/** Servidor escolhido na barra (a chamada, se houver, continua no canal dela). */
function onSelectServer(server) {
  ui.roomView.classList.toggle('no-servers', !server);
  if (!state.inRoom) ui.channelTitle.textContent = server?.name ?? '';
}

const serversUi = createServersUi({
  onSelect: onSelectServer,
  onJoinChannel: (server, channel) => join(server, channel),
  activeChannelId: () => (state.inRoom ? Number(state.room) : null),
  joining: () => state.joining,
  paintAvatar,
  onStatus: (message, level) => setStatus(message, level),
  afterChannels: placeChannelExtras,
});
for (const btn of muteButtons) btn.addEventListener('click', toggleMute);
for (const btn of [ui.leaveBtn, ui.barLeave]) btn.addEventListener('click', () => leave());
for (const kind of ['camera', 'screen']) {
  for (const btn of streamButtons[kind]) btn.addEventListener('click', () => toggleStream(kind));
}
ui.pipBtn.addEventListener('click', togglePictureInPicture);
ui.fullscreenBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);
ui.stopStreamBtn.addEventListener('click', () => stopStream());
ui.roomAlertClose.addEventListener('click', () => { ui.roomAlert.hidden = true; });
narrowScreen.addEventListener('change', renderStage);
document.addEventListener('keydown', (e) => {
  // Esc com a janela de prévia aberta: é dela (cancela a prévia), não do palco.
  if (e.key === 'Escape' && preview.isOpen) return;
  // Esc com o cartão de prévia aberto fecha só o cartão.
  if (e.key === 'Escape' && hoverCard.isOpen()) {
    hoverCard.hide({ restoreFocus: true });
    return;
  }
  // Esc sai do modo ampliado — mas não quando o Esc é para fechar um painel aberto ou sair de um
  // campo. Checa o painel ABERTO, não só "foco dentro de um painel": logo depois de fechar, o
  // foco ainda fica um instante no botão escondido, e um segundo Esc rápido seria ignorado.
  if (e.key !== 'Escape' || state.focus === null) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
    || e.target.closest?.('.menu:popover-open')) return;
  state.focus = null;
  renderStage();
});

buildLevelMeter();
setupMenus({ onOpen: onMenuOpen, onClose: onMenuClose });
hoverCard = setupHoverCard({
  list: ui.list,
  card: ui.streamCard,
  canShow: hasStreamCard,
  fill: fillStreamCard,
  onHide: () => { ui.streamCardVideo.srcObject = null; },
});
ui.streamCardWatch.addEventListener('click', watchStream);
const stats = createStatsPanel({
  panel: $('stats-panel'),
  summary: $('stats-summary'),
  peers: $('stats-peers'),
  close: $('stats-close'),
  getSession: () => state.session,
  nameOf: (id) => state.participants.get(id)?.name ?? id,
  note: () => `Codec preferido: ${state.videoCodec?.reason ?? '—'}`,
  onClose: () => { ui.optStats.checked = false; },
});
// ---- chat de texto ----
const chat = createChat({
  els: {
    scroll: $('chat-scroll'),
    list: $('chat-list'),
    more: $('chat-more'),
    start: $('chat-start'),
    startRoom: $('chat-start-room'),
    newBelow: $('chat-new'),
    typing: $('chat-typing'),
    form: $('chat-form'),
    input: $('chat-input'),
    error: $('chat-error'),
  },
  send: (text) => signaling.sendChatMessage(text),
  loadHistory: (beforeId) => signaling.getChatHistory(beforeId),
  typing: () => signaling.typing(),
  myConnectionId: () => signaling.connectionId,
  nameOf: (id) => state.participants.get(id)?.name ?? null,
  paintAvatar,
  onUnreadChange: renderChatUnread,
  onIncoming: ({ unseen }) => { if (unseen) playMessageSound(); },
  errorMessage,
});

let lastMessageSound = 0;
/**
 * "Plim" curto (dois tons) para mensagem que não está à vista (chat fechado, aba escondida ou
 * rolado para cima). Respeita a opção do menu ⋯, o "Desativar áudio" e o volume de saída.
 */
function playMessageSound() {
  const ctx = state.audioContext;
  const now = Date.now();
  if (!state.chatSound || state.deafened || !ctx || ctx.state === 'closed' || now - lastMessageSound < 1500) return;
  lastMessageSound = now;
  ctx.resume().catch(() => {});
  const t = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const peak = 0.08 * state.outputVolume;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  for (const [freq, start] of [[880, 0], [1320, 0.07]]) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(t + start);
    osc.stop(t + start + 0.15);
  }
}

function renderChatUnread(count) {
  ui.chatUnread.hidden = count === 0;
  ui.chatUnread.textContent = count > 99 ? '99+' : String(count);
  ui.chatToggle.setAttribute('aria-label', count ? `Chat (${count} não lidas)` : 'Chat');
}

/**
 * Abre/fecha o chat no palco. Aberto: ocupa o lugar da grade e os blocos viram miniaturas no
 * topo (o bloco ampliado volta para a faixa). Fechado: volta para a grade.
 */
function setChatOpen(open, { focus = false, render = true } = {}) {
  state.chatMode = open;
  if (open) state.focus = null;
  ui.main.classList.toggle('chat-mode', open);
  ui.chatToggle.setAttribute('aria-expanded', String(open));
  ui.chatToggle.title = open ? 'Fechar chat' : 'Abrir chat';
  // Primeiro o palco (a faixa de miniaturas muda a altura do chat), depois o chat rola até o fim.
  if (render) renderStage();
  chat.setOpen(open);
  if (open && focus) chat.focusInput();
  if (!open && focus) ui.chatToggle.focus({ preventScroll: true });
}

setChatOpen(false);
ui.chatToggle.addEventListener('click', () => setChatOpen(!state.chatMode, { focus: true }));
ui.chatClose.addEventListener('click', () => setChatOpen(false, { focus: true }));
$('chat-panel').addEventListener('keydown', (e) => {
  // Esc dentro do chat recolhe o chat (volta para a grade).
  if (e.key === 'Escape') setChatOpen(false, { focus: true });
});

ui.optChatSound.addEventListener('change', () => {
  state.chatSound = ui.optChatSound.checked;
  writePref('voz.chatSound', state.chatSound);
});
ui.optAutowatch.addEventListener('change', () => setAutoWatch(ui.optAutowatch.checked));
ui.stopWatchingBtn.addEventListener('click', () => setWatching(false));
ui.optStats.addEventListener('change', () => (ui.optStats.checked ? stats.show() : stats.hide()));
for (const kind of ['camera', 'screen']) {
  const c = qualityControls[kind];
  const onChange = () => changeQuality(kind, qualityFromSelects(c.resolution, c.fps));
  c.resolution.addEventListener('change', onChange);
  c.fps.addEventListener('change', onChange);
  c.preview.addEventListener('change', () => setAlwaysPreview(kind, c.preview.checked));
  c.budget.addEventListener('change', () => setUploadBudget(Number(c.budget.value)));
}
ui.micSelect.addEventListener('change', () => switchMic(ui.micSelect.value));
ui.speakerSelect.addEventListener('change', () => selectSpeaker(ui.speakerSelect.value));
ui.outputVolume.addEventListener('input', () => setOutputVolume(Number(ui.outputVolume.value) / 100));
ui.optDeafen.addEventListener('change', () => setDeafened(ui.optDeafen.checked));
ui.menuScreenStop.addEventListener('click', () => { closeAllMenus(); stopStream(); });
ui.menuScreenChange.addEventListener('click', changeScreen);
ui.cameraSelect.addEventListener('change', () => selectCamera(ui.cameraSelect.value));
ui.menuInvite.addEventListener('click', copyInvite);
ui.optGrid.addEventListener('change', () => setGridView(ui.optGrid.checked));
ui.optNonvideo.addEventListener('change', () => setShowNonVideo(ui.optNonvideo.checked));
onDeviceChange(() => {
  if (ui.menuCamera.matches(':popover-open')) refreshCameraList();
  if (ui.menuMic.matches(':popover-open')) refreshMicMenu();
});
window.addEventListener('pagehide', () => { if (state.inRoom) signaling.stop(); });

ui.menuLogout.addEventListener('click', signOut);
$('no-server-logout').addEventListener('click', signOut);
boot();
render();
