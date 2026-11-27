// Painel "Estatísticas da transmissão": o que cada conexão está enviando/recebendo de vídeo,
// quanto de upload/download no total e o que está limitando a qualidade (CPU ou banda).
// Serve para medir o gargalo real antes de decidir otimizações (ex.: migrar para SFU).
// Só amostra enquanto o painel está aberto (getStats tem custo).

const INTERVAL_MS = 2000;

const LIMITATION = { none: 'nenhum', cpu: 'CPU', bandwidth: 'banda', other: 'outro' };

const mbps = (bps) => `${(bps / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 1 })} Mbps`;
const rate = (bytes, prevBytes, dtMs) => (dtMs > 0 ? Math.max(0, ((bytes - prevBytes) * 8 * 1000) / dtMs) : 0);
const size = (s) => (s?.width && s?.height ? `${s.width}×${s.height}` : null);
const fps = (s) => (s?.fps !== undefined ? `${Math.round(s.fps)} FPS` : null);
const impl = (codec, name) => [codec, name && `(${name})`].filter(Boolean).join(' ');

/**
 * @param {{
 *   panel: HTMLElement,
 *   summary: HTMLElement,
 *   peers: HTMLElement,
 *   close: HTMLElement,
 *   getSession: () => { collectStats: () => Promise<import('./mesh.js').PeerStats[]> } | null,
 *   nameOf: (id: string) => string,
 *   note?: () => string,
 *   onClose?: () => void,
 * }} options
 */
export function createStatsPanel({ panel, summary, peers, close, getSession, nameOf, note, onClose }) {
  let timer = 0;
  /** @type {Map<string, import('./mesh.js').PeerStats>} */
  let previous = new Map();

  close.addEventListener('click', () => { hide(); onClose?.(); });

  async function tick() {
    const session = getSession();
    if (!session) { render([], new Map()); return; }
    const samples = await session.collectStats();
    if (panel.hidden) return; // fechou enquanto amostrava
    render(samples, previous);
    previous = new Map(samples.map((s) => [s.id, s]));
  }

  function render(samples, prev) {
    let up = 0; let down = 0; let sendingTo = 0;
    const rows = samples.map((s) => {
      const p = prev.get(s.id);
      const dt = p ? s.timestamp - p.timestamp : 0;
      up += p ? rate(s.bytesSent, p.bytesSent, dt) : 0;
      down += p ? rate(s.bytesReceived, p.bytesReceived, dt) : 0;

      const outBps = p?.out && s.out ? rate(s.out.bytes, p.out.bytes, dt) : 0;
      const inBps = p?.in && s.in ? rate(s.in.bytes, p.in.bytes, dt) : 0;
      // "Enviando" = quadros codificados nesta janela (não só bytes: RTCP também conta).
      const sending = !!(p?.out && s.out && s.out.frames > p.out.frames);
      const receiving = !!(p?.in && s.in && s.in.frames > p.in.frames);
      if (sending) sendingTo++;

      const out = !p ? 'medindo…' : !sending ? 'não está enviando' : [
        size(s.out), fps(s.out), mbps(outBps), impl(s.out.codec, s.out.encoder),
        s.out.limitation && `limitado por: ${LIMITATION[s.out.limitation] ?? s.out.limitation}`,
      ].filter(Boolean).join(' · ');

      let inText = !p ? 'medindo…' : 'não está recebendo';
      if (receiving) {
        const frames = s.in.frames - p.in.frames;
        const decodeMs = frames > 0 ? ((s.in.decodeTime - p.in.decodeTime) * 1000) / frames : 0;
        inText = [
          size(s.in), fps(s.in), mbps(inBps), impl(s.in.codec, s.in.decoder),
          `decodificação ${decodeMs.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ms/quadro`,
          `perdidos ${s.in.dropped}`,
        ].filter(Boolean).join(' · ');
      }

      const li = document.createElement('li');
      li.className = 'stats-peer';
      // Dados crus para quem depura (e para os testes automatizados).
      li.dataset.peer = s.id;
      li.dataset.sending = String(sending);
      li.dataset.receiving = String(receiving);
      li.dataset.outBps = String(Math.round(outBps));
      li.dataset.inBps = String(Math.round(inBps));
      const name = document.createElement('strong');
      name.textContent = nameOf(s.id);
      const outLine = document.createElement('span');
      outLine.textContent = `Envio: ${out}`;
      const inLine = document.createElement('span');
      inLine.textContent = `Recebimento: ${inText}`;
      li.append(name, outLine, inLine);
      return li;
    });

    peers.replaceChildren(...rows);
    if (!rows.length) {
      const empty = document.createElement('li');
      empty.className = 'stats-empty';
      empty.textContent = 'Ninguém mais na sala.';
      peers.append(empty);
    }
    const measured = samples.some((s) => prev.has(s.id));
    summary.textContent = (!measured ? 'Medindo…'
      : `Upload total ${mbps(up)} · Download total ${mbps(down)} · Vídeo indo para ${sendingTo} de ${samples.length}`)
      + (note ? ` · ${note()}` : '');
    summary.dataset.up = String(Math.round(up));
    summary.dataset.down = String(Math.round(down));
    summary.dataset.sendingTo = String(sendingTo);
  }

  function show() {
    if (!panel.hidden) return;
    panel.hidden = false;
    previous = new Map();
    summary.textContent = 'Medindo…';
    peers.replaceChildren();
    tick();
    timer = setInterval(tick, INTERVAL_MS);
  }

  function hide() {
    if (panel.hidden) return;
    panel.hidden = true;
    clearInterval(timer);
    timer = 0;
    previous = new Map();
  }

  return { show, hide, get isOpen() { return !panel.hidden; } };
}
