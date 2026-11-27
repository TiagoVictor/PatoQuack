// Cartão de prévia de um participante (ex.: quem está transmitindo), aberto ao passar o mouse
// na linha dele na lista, ou ao clicar/tocar/apertar Enter nela (no toque não existe "passar o
// mouse"). O conteúdo é do app; aqui fica só quando abrir, fechar e onde posicionar.
//
// A lista é redesenhada inteira a cada mudança (ex.: alguém começa a falar), então o cartão NÃO
// fica dentro dela: é um popover único (popover="manual", na camada superior, sem ser cortado pela
// barra lateral) que acha a linha atual pelo data-id sempre que precisa se posicionar.

const OPEN_DELAY = 350;  // ms parado em cima antes de abrir: atravessar a lista não pisca o cartão
const CLOSE_DELAY = 200; // folga para levar o mouse da linha até o cartão
const GAP = 8;
const MARGIN = 8;

/**
 * @param {{
 *   list: HTMLElement,
 *   card: HTMLElement,
 *   canShow: (id: string) => boolean,
 *   fill: (id: string) => void,
 *   onHide?: () => void,
 * }} options
 *   canShow: se a linha `id` tem cartão (ex.: só quem está transmitindo).
 *   fill: preenche o cartão para `id`; chamado ao abrir e a cada refresh().
 *   onHide: chamado ao fechar (ex.: soltar o vídeo da prévia).
 */
export function setupHoverCard({ list, card, canShow, fill, onHide }) {
  let currentId = null;
  let pinned = false; // aberto por clique/teclado: não fecha ao tirar o mouse
  let openTimer = 0;
  let closeTimer = 0;

  const rowOf = (id) => (id === null ? null : list.querySelector(`li[data-id="${CSS.escape(id)}"]`));
  const isOpen = () => currentId !== null;

  function cancelTimers() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    openTimer = closeTimer = 0;
  }

  function show(id, { pin = false } = {}) {
    cancelTimers();
    if (!canShow(id)) return;
    const switching = currentId !== null && currentId !== id;
    if (switching) rowOf(currentId)?.setAttribute('aria-expanded', 'false');
    currentId = id;
    pinned = pin;
    fill(id);
    if (!card.matches(':popover-open')) {
      card.style.visibility = 'hidden'; // posiciona antes de aparecer, sem piscar no centro
      card.showPopover();
    }
    position();
    card.style.visibility = '';
    rowOf(id)?.setAttribute('aria-expanded', 'true');
  }

  function hide({ restoreFocus = false } = {}) {
    cancelTimers();
    if (currentId === null) return;
    const row = rowOf(currentId);
    const hadFocus = card.contains(document.activeElement);
    row?.setAttribute('aria-expanded', 'false');
    currentId = null;
    pinned = false;
    if (card.matches(':popover-open')) card.hidePopover();
    if (hadFocus && restoreFocus) row?.focus({ preventScroll: true });
    onHide?.();
  }

  function scheduleOpen(id) {
    clearTimeout(closeTimer);
    closeTimer = 0;
    if (currentId === id) return;
    clearTimeout(openTimer);
    // Já aberto para outra pessoa: troca na hora, como num menu.
    if (currentId !== null && !pinned) { show(id); return; }
    openTimer = setTimeout(() => { openTimer = 0; show(id); }, OPEN_DELAY);
  }

  function scheduleClose() {
    clearTimeout(openTimer);
    openTimer = 0;
    if (currentId === null || pinned || closeTimer) return;
    closeTimer = setTimeout(() => { closeTimer = 0; hide(); }, CLOSE_DELAY);
  }

  function position() {
    const row = rowOf(currentId);
    if (!row) return;
    const r = row.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const maxLeft = innerWidth - c.width - MARGIN;
    const maxTop = innerHeight - c.height - MARGIN;

    let left; let top;
    if (r.right + GAP <= maxLeft) {
      // Cabe ao lado direito da linha (fora da barra lateral, como no layout de desktop).
      left = r.right + GAP;
      top = Math.min(r.top, maxTop);
    } else {
      // Tela estreita: abaixo da linha; acima se não couber.
      left = Math.min(r.left, maxLeft);
      top = r.bottom + GAP <= maxTop ? r.bottom + GAP : r.top - c.height - GAP;
    }
    card.style.left = `${Math.max(MARGIN, left)}px`;
    card.style.top = `${Math.max(MARGIN, top)}px`;
  }

  // ---- mouse ----
  list.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const id = e.target.closest?.('li[data-id]')?.dataset.id ?? null;
    if (id !== null && canShow(id)) scheduleOpen(id);
    else scheduleClose();
  });
  list.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') scheduleClose(); });
  card.addEventListener('pointerenter', () => { clearTimeout(closeTimer); closeTimer = 0; });
  card.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') scheduleClose(); });

  // ---- clique / toque / teclado: fixa o cartão aberto (ou fecha, se já fixado) ----
  function activate(id, viaKeyboard) {
    if (!canShow(id)) return;
    if (currentId === id && pinned) { hide({ restoreFocus: true }); return; }
    show(id, { pin: true });
    if (viaKeyboard) card.querySelector('button:not([disabled]):not([hidden])')?.focus();
  }
  list.addEventListener('click', (e) => {
    const id = e.target.closest?.('li[data-id]')?.dataset.id;
    if (id !== undefined) activate(id, false);
  });
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const li = e.target.closest?.('li[data-id]');
    if (!li || e.target !== li) return;
    e.preventDefault();
    activate(li.dataset.id, true);
  });

  // Clique fora (nem no cartão, nem na linha dele) fecha.
  document.addEventListener('pointerdown', (e) => {
    if (currentId === null) return;
    if (card.contains(e.target) || rowOf(currentId)?.contains(e.target)) return;
    hide();
  });
  window.addEventListener('resize', () => hide());
  // A lista pode rolar dentro da barra lateral: acompanha a linha.
  document.addEventListener('scroll', (e) => {
    if (currentId !== null && !card.contains(e.target)) position();
  }, true);

  return {
    isOpen,
    /** O cartão está aberto para `id`? (para a lista marcar aria-expanded ao redesenhar) */
    isOpenFor: (id) => currentId === id,
    hide,
    /**
     * Chamar depois de redesenhar a lista ou mudar o estado: fecha se `id` deixou de ter cartão
     * (parou de transmitir, saiu da sala), senão atualiza o conteúdo e reposiciona.
     */
    refresh() {
      if (currentId === null) return;
      if (!canShow(currentId) || !rowOf(currentId)) { hide(); return; }
      fill(currentId);
      position();
    },
  };
}
