// Chat de texto da sala: lista de mensagens (histórico + ao vivo), envio, não lidas e
// "digitando". O servidor guarda e repassa (SignalR); aqui só exibimos.
//
// Segurança: o texto das mensagens NUNCA vira HTML. Tudo entra como nó de texto; links são
// criados com createElement só para http/https e abrem em aba nova sem acesso à nossa página.

const GROUP_GAP_MS = 7 * 60 * 1000; // mensagens da mesma pessoa até 7 min depois ficam agrupadas
const NEAR_BOTTOM_PX = 80;          // "está no fim da lista" (rola sozinho com mensagem nova)
const TYPING_SEND_MS = 3000;        // avisa "digitando" no máximo a cada 3 s
const TYPING_SHOW_MS = 5000;        // some 5 s depois do último aviso
const MAX_LENGTH = 2000;
const ERROR_MS = 6000;              // o aviso de erro some sozinho

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"»]+$/;

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * @typedef {{ id: number, authorName: string, text: string, sentAt: string, authorConnectionId?: string | null }} ChatMessageDto
 * @typedef {{ messages: ChatMessageDto[], hasMore: boolean }} ChatHistoryDto
 */

/**
 * @param {{
 *   els: Record<string, HTMLElement>,
 *   send: (text: string) => Promise<ChatMessageDto>,
 *   loadHistory: (beforeId: number | null) => Promise<ChatHistoryDto>,
 *   typing: () => Promise<void>,
 *   myConnectionId: () => string | null,
 *   nameOf: (connectionId: string) => string | null,
 *   paintAvatar: (el: HTMLElement, name: string) => void,
 *   onUnreadChange?: (count: number) => void,
 *   onIncoming?: (info: { unseen: boolean }) => void,
 *   errorMessage: (err: unknown) => string,
 * }} options
 */
export function createChat(options) {
  const { els } = options;
  /** @type {Map<number, true>} ids já exibidos (o ao vivo pode chegar durante o histórico). */
  let seen = new Map();
  let oldestId = null;
  let loadingHistory = false;
  let open = false;
  let unread = 0;
  let lastTypingSent = 0;
  let errorTimer = 0;
  /** @type {Map<string, number>} connectionId → timer do "digitando" */
  const typing = new Map();

  // ---- envio ----
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  els.input.addEventListener('keydown', (e) => {
    // Enter envia; Shift+Enter quebra a linha. Durante composição (acentos/IME) não envia.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  els.input.addEventListener('input', () => {
    autosize();
    hideError();
    const now = Date.now();
    if (els.input.value.trim() && now - lastTypingSent > TYPING_SEND_MS) {
      lastTypingSent = now;
      options.typing().catch(() => {});
    }
  });

  async function submit() {
    const text = els.input.value.trim();
    if (!text) return;
    if (text.length > MAX_LENGTH) {
      showError(`A mensagem passou de ${MAX_LENGTH} caracteres.`);
      return;
    }
    const draft = els.input.value;
    els.input.value = '';
    autosize();
    lastTypingSent = 0;
    try {
      const message = await options.send(text);
      add(message, { scroll: 'force' });
    } catch (err) {
      // Devolve o texto para não perder o que foi digitado (ex.: limite de envio).
      if (!els.input.value) {
        els.input.value = draft;
        autosize();
      }
      showError(options.errorMessage(err));
    }
  }

  function autosize() {
    els.input.style.height = 'auto';
    els.input.style.height = `${Math.min(els.input.scrollHeight, 160)}px`;
  }

  function showError(text) {
    els.error.textContent = text;
    els.error.hidden = false;
    clearTimeout(errorTimer);
    errorTimer = setTimeout(hideError, ERROR_MS);
  }

  function hideError() {
    clearTimeout(errorTimer);
    els.error.hidden = true;
  }

  // ---- rolagem e "novas mensagens" ----
  const nearBottom = () => els.scroll.scrollHeight - els.scroll.scrollTop - els.scroll.clientHeight < NEAR_BOTTOM_PX;
  const scrollToBottom = () => { els.scroll.scrollTop = els.scroll.scrollHeight; };

  // Estava no fim? (atualizado a cada rolagem). Se a área do chat muda de tamanho — a faixa de
  // miniaturas aparece, a janela muda — quem estava no fim continua no fim.
  let pinned = true;
  els.scroll.addEventListener('scroll', () => {
    pinned = nearBottom();
    if (pinned) {
      els.newBelow.hidden = true;
      markRead();
    }
  });
  new ResizeObserver(() => {
    if (pinned && els.scroll.clientHeight > 0) scrollToBottom();
  }).observe(els.scroll);
  els.newBelow.addEventListener('click', () => {
    scrollToBottom();
    els.newBelow.hidden = true;
    markRead();
  });
  els.more.addEventListener('click', () => loadOlder());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) markRead(); });

  // ---- não lidas ----
  const canSee = () => open && !document.hidden && nearBottom();

  function markRead() {
    if (!canSee() || unread === 0) return;
    unread = 0;
    options.onUnreadChange?.(0);
  }

  function bumpUnread() {
    unread++;
    options.onUnreadChange?.(unread);
  }

  // ---- renderização ----

  /** Adiciona uma mensagem ao fim (ao vivo ou enviada por nós). */
  function add(dto, { scroll = 'auto' } = {}) {
    if (seen.has(dto.id)) return;
    seen.set(dto.id, true);
    const stick = scroll === 'force' || nearBottom();
    const mine = dto.authorConnectionId != null && dto.authorConnectionId === options.myConnectionId();
    els.list.append(...render(toItem(dto, mine), lastItem()));
    clearTyping(dto.authorConnectionId);
    if (stick) scrollToBottom();
    else if (!mine) els.newBelow.hidden = false;
    if (!mine) {
      const unseen = !canSee();
      if (unseen) bumpUnread();
      options.onIncoming?.({ unseen });
    }
  }

  /** Linha de sistema ("Ana entrou"). Não é guardada no servidor nem conta como não lida. */
  function system(text) {
    const stick = nearBottom();
    els.list.append(...render({ system: true, text, sentAt: new Date() }, lastItem()));
    if (stick) scrollToBottom();
  }

  /** Mensagens antigas no topo, mantendo o que está na tela no mesmo lugar. */
  function prepend(dtos) {
    const fresh = dtos.filter((d) => !seen.has(d.id));
    if (!fresh.length) return;
    for (const d of fresh) seen.set(d.id, true);
    const before = els.scroll.scrollHeight;
    const nodes = [];
    let prev = null;
    for (const d of fresh) {
      const item = toItem(d, false);
      nodes.push(...render(item, prev));
      prev = item;
    }
    // A primeira mensagem que já estava na lista pode precisar de cabeçalho (ou separador de dia) diferente.
    const firstExisting = els.list.querySelector('.chat-msg, .chat-system');
    els.list.prepend(...nodes);
    if (firstExisting) rerenderAfter(firstExisting, prev);
    els.scroll.scrollTop += els.scroll.scrollHeight - before;
  }

  function toItem(dto, mine) {
    return { id: dto.id, author: dto.authorName, text: dto.text, sentAt: new Date(dto.sentAt), mine, system: false };
  }

  function lastItem() {
    const last = els.list.lastElementChild;
    return last ? itemOf(last) : null;
  }

  function itemOf(node) {
    return node.__item ?? null;
  }

  /** Nós de um item: separador de dia (se mudou o dia) + mensagem (com ou sem cabeçalho). */
  function render(item, prev) {
    const nodes = [];
    const newDay = !prev || prev.sentAt.toDateString() !== item.sentAt.toDateString();
    if (newDay) {
      const sep = document.createElement('li');
      sep.className = 'chat-day';
      sep.setAttribute('role', 'separator');
      sep.textContent = dayFormat.format(item.sentAt);
      sep.__item = { ...item, separator: true };
      nodes.push(sep);
    }

    const li = document.createElement('li');
    li.__item = item;
    if (item.system) {
      li.className = 'chat-system';
      const time = document.createElement('time');
      time.dateTime = item.sentAt.toISOString();
      time.textContent = timeFormat.format(item.sentAt);
      li.append(document.createTextNode(item.text), time);
      nodes.push(li);
      return nodes;
    }

    const grouped = !newDay && prev && !prev.system && !prev.separator
      && prev.author === item.author && item.sentAt - prev.sentAt < GROUP_GAP_MS;
    li.className = `chat-msg${grouped ? ' grouped' : ''}${item.mine ? ' mine' : ''}`;
    li.dataset.id = String(item.id);

    if (!grouped) {
      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.setAttribute('aria-hidden', 'true');
      options.paintAvatar(avatar, item.author);
      const head = document.createElement('div');
      head.className = 'chat-head-line';
      const name = document.createElement('strong');
      name.className = 'chat-author';
      name.textContent = item.author;
      head.append(name, timeEl(item.sentAt));
      li.append(avatar, head);
    } else {
      const hover = timeEl(item.sentAt);
      hover.classList.add('chat-time-hover');
      li.append(hover);
    }

    const body = document.createElement('p');
    body.className = 'chat-text';
    body.append(...linkify(item.text));
    li.append(body);
    nodes.push(li);
    return nodes;
  }

  function timeEl(date) {
    const time = document.createElement('time');
    time.className = 'chat-time';
    time.dateTime = date.toISOString();
    time.textContent = timeFormat.format(date);
    time.title = `${dayFormat.format(date)} ${timeFormat.format(date)}`;
    return time;
  }

  /** Recria o primeiro item antigo depois de um prepend (agrupamento/separador dependem do anterior). */
  function rerenderAfter(node, prev) {
    // Remove o separador de dia que ele tinha, se o anterior novo for do mesmo dia.
    const item = itemOf(node);
    const sep = node.previousElementSibling;
    const replacement = render(item, prev);
    if (sep?.classList.contains('chat-day') && itemOf(sep)?.id === item.id) sep.remove();
    node.replaceWith(...replacement);
  }

  /** Texto → nós: links http/https clicáveis, o resto como texto puro. */
  function linkify(text) {
    const nodes = [];
    let last = 0;
    for (const match of text.matchAll(URL_PATTERN)) {
      let url = match[0];
      const trailing = url.match(TRAILING_PUNCTUATION)?.[0] ?? '';
      url = url.slice(0, url.length - trailing.length);
      const start = match.index;
      if (start > last) nodes.push(document.createTextNode(text.slice(last, start)));
      nodes.push(safeLink(url) ?? document.createTextNode(url));
      last = start + url.length;
    }
    if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
    return nodes;
  }

  function safeLink(raw) {
    let url;
    try { url = new URL(raw); } catch { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const a = document.createElement('a');
    a.href = url.href;
    a.textContent = raw;
    a.target = '_blank';
    a.rel = 'noopener noreferrer nofollow';
    return a;
  }

  // ---- histórico ----

  async function loadOlder() {
    if (loadingHistory) return;
    loadingHistory = true;
    els.more.disabled = true;
    try {
      const page = await options.loadHistory(oldestId);
      if (page.messages.length) oldestId = page.messages[0].id;
      const firstLoad = seen.size === 0;
      prepend(page.messages);
      els.more.hidden = !page.hasMore;
      els.start.hidden = page.hasMore;
      if (firstLoad) scrollToBottom();
    } catch (err) {
      showError(`Não foi possível carregar o histórico: ${options.errorMessage(err)}`);
    } finally {
      loadingHistory = false;
      els.more.disabled = false;
    }
  }

  // ---- digitando ----

  function onTyping(connectionId) {
    if (!options.nameOf(connectionId)) return;
    clearTimeout(typing.get(connectionId));
    typing.set(connectionId, setTimeout(() => clearTyping(connectionId), TYPING_SHOW_MS));
    renderTyping();
  }

  function clearTyping(connectionId) {
    if (!connectionId || !typing.has(connectionId)) return;
    clearTimeout(typing.get(connectionId));
    typing.delete(connectionId);
    renderTyping();
  }

  function renderTyping() {
    const names = [...typing.keys()].map(options.nameOf).filter(Boolean);
    els.typing.textContent = names.length === 0 ? ''
      : names.length === 1 ? `${names[0]} está digitando…`
      : names.length === 2 ? `${names[0]} e ${names[1]} estão digitando…`
      : 'Várias pessoas estão digitando…';
  }

  return {
    /** Entrou numa sala: limpa e carrega a página mais recente do histórico. */
    async start(room) {
      this.reset();
      els.input.placeholder = `Conversar em #${room}`;
      els.startRoom.textContent = `#${room}`;
      await loadOlder();
    },
    /** Saiu da sala: esquece tudo. */
    reset() {
      seen = new Map();
      pinned = true;
      oldestId = null;
      unread = 0;
      options.onUnreadChange?.(0);
      for (const t of typing.values()) clearTimeout(t);
      typing.clear();
      renderTyping();
      els.list.replaceChildren();
      els.more.hidden = true;
      els.start.hidden = true;
      els.newBelow.hidden = true;
      els.input.value = '';
      autosize();
      hideError();
    },
    onMessage: (dto) => add(dto),
    onTyping,
    /** Pessoa saiu: tira o "digitando" dela. */
    forget: (connectionId) => clearTyping(connectionId),
    system,
    setOpen(value) {
      open = value;
      if (open) {
        if (els.newBelow.hidden) scrollToBottom();
        markRead();
      }
    },
    focusInput: () => els.input.focus(),
    get unread() { return unread; },
  };
}
