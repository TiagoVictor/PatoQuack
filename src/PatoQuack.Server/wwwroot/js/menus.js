// Painéis da barra de controles, usando o popover nativo do navegador (atributo `popover`):
// ele já cuida de abrir/fechar pelo botão (popovertarget), fechar com Esc ou clique fora, e
// devolver o foco ao botão. Aqui só posicionamos o painel junto do botão indicado em
// data-anchor (acima dele; abaixo se não couber) e levamos o foco para o primeiro controle.
//
// Requer suporte a popover (Safari 17+, Chrome 114+, Firefox 125+).

const MARGIN = 8;

/**
 * @param {{ onOpen?: (menu: HTMLElement) => void, onClose?: (menu: HTMLElement) => void }} [options]
 *   onOpen: chamado antes de posicionar, para o app preencher o conteúdo (ex.: lista de dispositivos).
 *   onClose: chamado ao fechar (ex.: parar o medidor de nível do microfone).
 */
export function setupMenus({ onOpen, onClose } = {}) {
  for (const menu of document.querySelectorAll('.menu[popover]')) {
    const anchor = document.getElementById(menu.dataset.anchor);

    // beforetoggle é síncrono (o 'toggle' chega depois, numa tarefa à parte): fechar aqui faz o
    // painel parar o que estiver fazendo e soltar o foco no mesmo instante em que some.
    menu.addEventListener('beforetoggle', (e) => {
      if (e.newState === 'open') {
        // Esconde até posicionar, para não piscar na posição padrão (centro da tela).
        menu.style.visibility = 'hidden';
        return;
      }
      anchor?.classList.remove('open');
      // Fechando com o foco dentro: devolve ao botão que abriu (o navegador só faz isso se o
      // botão tinha foco antes — o que não acontece com clique no Safari).
      if (menu.contains(document.activeElement) && anchor && !anchor.hidden) anchor.focus({ preventScroll: true });
      onClose?.(menu);
    });

    menu.addEventListener('toggle', (e) => {
      // O 'toggle' de abertura pode chegar depois de um fechamento rápido: confere o estado real.
      if (e.newState !== 'open' || !menu.matches(':popover-open')) return;
      anchor?.classList.add('open');
      onOpen?.(menu);
      position(menu, anchor);
      menu.style.visibility = '';
      menu.querySelector(':is(select, input, button):not([disabled]):not([hidden])')?.focus();
    });
  }

  // Ao redimensionar, a âncora muda de lugar: fecha em vez de deixar o painel solto.
  window.addEventListener('resize', closeAllMenus);
}

export function closeAllMenus() {
  for (const menu of document.querySelectorAll('.menu:popover-open')) menu.hidePopover();
}

/** Reposiciona um painel aberto (ex.: depois de o conteúdo mudar de tamanho). */
export function repositionMenu(menu) {
  if (menu.matches(':popover-open')) position(menu, document.getElementById(menu.dataset.anchor));
}

function position(menu, anchor) {
  if (!anchor) return;
  const a = anchor.getBoundingClientRect();
  const m = menu.getBoundingClientRect();

  let top = a.top - m.height - MARGIN;
  if (top < MARGIN) top = Math.min(a.bottom + MARGIN, innerHeight - m.height - MARGIN);

  const left = Math.max(MARGIN, Math.min(a.left + a.width / 2 - m.width / 2, innerWidth - m.width - MARGIN));

  menu.style.top = `${Math.max(MARGIN, top)}px`;
  menu.style.left = `${left}px`;
}
