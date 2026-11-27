// Janela de prévia antes de transmitir ("Vamos ligar a câmera?" / tela).
// Nada sai para a sala enquanto ela está aberta: a mídia capturada só é mostrada aqui. Ao
// confirmar, a MESMA mídia é devolvida para o app transmitir (sem desligar e religar a câmera);
// ao cancelar (X, Esc, clique fora, sair da sala), a captura é encerrada.
//
// Usa <dialog> nativo com showModal (Safari 15.4+): o resto da página fica inerte enquanto aberto.

import { constraintsFor, fillQualitySelects, qualityFromSelects } from './quality.js';

const TEXTS = {
  camera: { title: 'Vamos ligar a câmera?', confirm: 'Ativar câmera' },
  screen: { title: 'Transmitir a tela?', confirm: 'Transmitir' },
};

/**
 * @typedef {{
 *   kind: 'camera' | 'screen',
 *   media: MediaStream,
 *   quality: { resolution: string, fps: number },
 *   alwaysPreview: boolean,
 *   recapture: (options?: { deviceId?: string }) => Promise<MediaStream>,
 *   fillCameras?: (select: HTMLSelectElement, media: MediaStream) => Promise<void>,
 *   estimate: (quality: { resolution: string, fps: number }) => string,
 *   onQualityChange: (quality: { resolution: string, fps: number }) => void,
 *   onAlwaysChange: (always: boolean) => void,
 *   onCameraChange?: (deviceId: string) => void,
 *   onError: (message: string) => void,
 * }} PreviewOptions
 */

export class VideoPreview {
  /** @param {Record<string, HTMLElement>} els */
  constructor(els) {
    this.els = els;
    /** @type {(PreviewOptions & { resolve: (r: { media: MediaStream, quality: object } | null) => void }) | null} */
    this.ctx = null;
    this.busy = false;
    this.blocked = null;

    const { dialog, close, confirm, cameraSelect, resolution, fps, rechoose, always } = els;
    close.addEventListener('click', () => this.cancel());
    confirm.addEventListener('click', () => this.#confirm());
    // Esc: o navegador fecha sozinho; tratamos como cancelar (e encerramos a captura).
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); this.cancel(); });
    // Clique no fundo escurecido (fora do conteúdo) também cancela.
    dialog.addEventListener('click', (e) => { if (e.target === dialog) this.cancel(); });
    // Fechada por outro caminho: cancela. O evento 'close' chega numa tarefa depois do close(); se a
    // janela já foi reaberta nesse meio-tempo, ele é do fechamento anterior e não pode cancelar a nova.
    dialog.addEventListener('close', () => { if (this.ctx && !dialog.open) this.cancel(); });
    cameraSelect.addEventListener('change', () => this.#changeCamera(cameraSelect.value));
    resolution.addEventListener('change', () => this.#changeQuality());
    fps.addEventListener('change', () => this.#changeQuality());
    rechoose.addEventListener('click', () => this.#rechoose());
    always.addEventListener('change', () => this.ctx?.onAlwaysChange(always.checked));
  }

  get isOpen() { return this.ctx !== null; }

  /**
   * Mostra a prévia. Resolve com { media, quality } se confirmou, ou null se cancelou.
   * @param {PreviewOptions} options
   */
  open(options) {
    this.cancel(); // segurança: nunca duas prévias ao mesmo tempo
    const { els } = this;
    const { kind } = options;
    return new Promise((resolve) => {
      this.ctx = { ...options, resolve };
      els.title.textContent = TEXTS[kind].title;
      els.confirmLabel.textContent = TEXTS[kind].confirm;
      els.cameraField.hidden = kind !== 'camera';
      els.rechoose.hidden = kind !== 'screen';
      els.always.checked = options.alwaysPreview;
      fillQualitySelects(els.resolution, els.fps, kind, options.quality);
      this.#show(options.media);
      if (kind === 'camera') options.fillCameras?.(els.cameraSelect, options.media);
      this.refresh();
      els.dialog.showModal();
      els.confirm.focus();
    });
  }

  /** Cancela (se aberta): encerra a captura da prévia e fecha. */
  cancel() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.ctx = null;
    this.#stop(ctx.media);
    this.#close();
    ctx.resolve(null);
  }

  /**
   * Bloqueia a confirmação com um aviso (ex.: outra pessoa começou a transmitir), ou libera (null).
   * @param {string | null} message
   */
  setBlocked(message) {
    this.blocked = message;
    this.refresh();
  }

  /** Atualiza estimativa de upload, aviso e botão (chamar quando a sala muda). */
  refresh() {
    const { els, ctx } = this;
    if (!ctx) return;
    els.estimate.textContent = ctx.estimate(qualityFromSelects(els.resolution, els.fps));
    els.blocked.hidden = !this.blocked;
    els.blocked.textContent = this.blocked ?? '';
    els.confirm.disabled = this.busy || !!this.blocked;
  }

  #confirm() {
    const ctx = this.ctx;
    if (!ctx || this.busy || this.blocked) return;
    this.ctx = null;
    for (const t of ctx.media.getTracks()) t.onended = null;
    this.#close();
    ctx.resolve({ media: ctx.media, quality: qualityFromSelects(this.els.resolution, this.els.fps) });
  }

  #show(media) {
    const ctx = this.ctx;
    ctx.media = media;
    const { video, waiting } = this.els;
    video.srcObject = media;
    video.play().catch(() => {});
    waiting.hidden = true;
    // Captura encerrada por fora (botão "parar compartilhamento" do navegador, câmera desconectada).
    const [track] = media.getVideoTracks();
    if (track) {
      track.onended = () => {
        if (this.ctx?.media !== media) return;
        ctx.onError(ctx.kind === 'screen' ? 'O compartilhamento da tela foi encerrado.' : 'A câmera foi desconectada.');
        this.cancel();
      };
    }
  }

  #close() {
    const { dialog, video } = this.els;
    video.srcObject = null;
    this.busy = false;
    this.blocked = null;
    if (dialog.open) dialog.close();
  }

  #stop(media) {
    for (const t of media?.getTracks() ?? []) {
      t.onended = null;
      t.stop();
    }
  }

  async #withBusy(fn) {
    this.busy = true;
    this.refresh();
    try {
      await fn();
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  /** Outra câmera: solta a atual antes (no celular só uma câmera abre por vez) e captura a nova. */
  #changeCamera(deviceId) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.onCameraChange?.(deviceId);
    return this.#withBusy(async () => {
      this.#stop(ctx.media);
      this.els.waiting.hidden = false;
      try {
        const media = await ctx.recapture({ deviceId });
        if (this.ctx !== ctx) { this.#stop(media); return; } // fechou enquanto capturava
        this.#show(media);
      } catch (err) {
        if (this.ctx !== ctx) return;
        ctx.onError(`Não foi possível abrir essa câmera: ${err?.message ?? err}`);
        this.cancel();
      }
    });
  }

  /** Resolução/FPS: aplica na captura atual (sem recapturar), para a prévia já mostrar o resultado. */
  #changeQuality() {
    const ctx = this.ctx;
    if (!ctx) return;
    const quality = qualityFromSelects(this.els.resolution, this.els.fps);
    return this.#withBusy(async () => {
      const [track] = ctx.media.getVideoTracks();
      try {
        await track?.applyConstraints(constraintsFor(ctx.kind, quality));
      } catch (err) {
        ctx.onError(`Essa qualidade não é suportada aqui: ${err?.message ?? err}`);
      }
      if (this.ctx === ctx) ctx.onQualityChange(quality);
    });
  }

  /** Tela: abre o seletor do navegador de novo. Cancelar o seletor mantém a tela anterior. */
  #rechoose() {
    const ctx = this.ctx;
    if (!ctx) return;
    return this.#withBusy(async () => {
      let media;
      try {
        media = await ctx.recapture();
      } catch (err) {
        if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') ctx.onError(`Não foi possível trocar a tela: ${err?.message ?? err}`);
        return;
      }
      if (this.ctx !== ctx) { this.#stop(media); return; }
      const old = ctx.media;
      this.#show(media);
      this.#stop(old);
    });
  }
}
