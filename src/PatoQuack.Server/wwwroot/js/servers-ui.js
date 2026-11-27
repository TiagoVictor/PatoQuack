// Servidores na interface: barra de ícones (rail), menu do servidor, lista de canais e as
// janelas de criar, renomear, convidar, membros e confirmação. A chamada em si fica no app.js:
// aqui só avisamos "a pessoa clicou no canal X" (onJoinChannel).

import {
  createServer, createServerInvite, deleteServer, leaveServer, listMembers, listServers, renameServer,
} from './api.js';

const $ = (id) => document.getElementById(id);

/**
 * @typedef {{ id: number, name: string, kind: 'voice' | 'text' }} Channel
 * @typedef {{ id: number, name: string, isOwner: boolean, channels: Channel[] }} Server
 */

/**
 * @param {{
 *   onSelect: (server: Server | null) => void,
 *   onJoinChannel: (server: Server, channel: Channel) => void,
 *   activeChannelId: () => number | null,
 *   joining: () => boolean,
 *   paintAvatar: (el: HTMLElement, name: string) => void,
 *   onStatus: (message: string, level?: string) => void,
 *   afterChannels?: () => void,
 * }} options
 */
export function createServersUi(options) {
  const ui = {
    list: $('server-list'),
    add: $('add-server-btn'),
    name: $('server-name'),
    menuBtn: $('server-menu-btn'),
    menu: $('menu-server'),
    invite: $('server-invite'),
    members: $('server-members'),
    rename: $('server-rename'),
    remove: $('server-delete'),
    leave: $('server-leave'),
    channels: $('channel-list'),
    noServer: $('no-server'),
    noServerCreate: $('no-server-create'),
    pasteForm: $('invite-paste-form'),
    paste: $('invite-paste'),
  };
  /** @type {Server[]} */
  let servers = [];
  /** @type {Server | null} */
  let current = null;

  // ---- dados ----

  async function load(preferredId = null) {
    servers = await listServers();
    const keep = preferredId ?? current?.id ?? null;
    select(servers.find((s) => s.id === Number(keep)) ?? servers[0] ?? null);
  }

  function select(server) {
    current = server;
    if (server) {
      try { localStorage.setItem('voz.server', String(server.id)); } catch { /* sem storage */ }
    }
    render();
    options.onSelect(server);
  }

  // ---- render ----

  function render() {
    ui.list.replaceChildren(...servers.map((s) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rail-btn';
      btn.dataset.serverId = String(s.id);
      btn.title = s.name;
      btn.setAttribute('aria-label', s.name);
      btn.setAttribute('aria-current', String(s.id === current?.id));
      options.paintAvatar(btn, s.name);
      btn.textContent = initials(s.name);
      btn.addEventListener('click', () => { if (s.id !== current?.id) select(s); });
      li.append(btn);
      return li;
    }));

    ui.noServer.hidden = servers.length > 0;
    ui.menuBtn.disabled = !current;
    ui.name.textContent = current?.name ?? 'PatoQuack';
    ui.rename.hidden = ui.remove.hidden = !current?.isOwner;
    ui.leave.hidden = !current || current.isOwner;
    renderChannels();
  }

  function renderChannels() {
    const active = options.activeChannelId();
    const voice = current?.channels.filter((c) => c.kind === 'voice') ?? [];
    ui.channels.replaceChildren(...voice.map((c) => {
      const li = document.createElement('li');
      li.dataset.channelId = String(c.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'channel-btn';
      btn.dataset.channelId = String(c.id);
      btn.setAttribute('aria-current', String(c.id === active));
      btn.disabled = options.joining();
      btn.title = c.id === active ? `Você está em ${c.name}` : `Entrar em ${c.name}`;
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('class', 'icon');
      icon.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#i-volume');
      icon.append(use);
      const name = document.createElement('span');
      name.className = 'channel-name';
      name.textContent = c.name;
      btn.append(icon, name);
      btn.addEventListener('click', () => { if (c.id !== options.activeChannelId()) options.onJoinChannel(current, c); });
      li.append(btn);
      return li;
    }));
    options.afterChannels?.();
  }

  // ---- janelas ----

  function bindDialog(dialog) {
    dialog.querySelectorAll('.modal-cancel').forEach((b) => b.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  }

  function showError(el, message) {
    el.textContent = message;
    el.hidden = !message;
  }

  /** Confirmação genérica (apagar/sair). Resolve true se confirmou e a ação deu certo. */
  function confirmAction({ title, text, ok, action }) {
    const d = $('dialog-confirm');
    $('dialog-confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-ok').textContent = ok;
    showError($('confirm-error'), '');
    $('confirm-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await action();
        d.close();
      } catch (err) {
        showError($('confirm-error'), err.message);
      }
    };
    d.showModal();
  }

  for (const id of ['dialog-create', 'dialog-rename', 'dialog-invite', 'dialog-members', 'dialog-confirm']) bindDialog($(id));

  function openCreate() {
    $('create-name').value = '';
    showError($('create-error'), '');
    $('dialog-create').showModal();
    $('create-name').focus();
  }
  $('create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const server = await createServer($('create-name').value);
      $('dialog-create').close();
      await load(server.id);
      options.onStatus(`Servidor "${server.name}" criado. Convide as pessoas pelo menu do servidor.`);
    } catch (err) {
      showError($('create-error'), err.message);
    }
  });

  function openRename() {
    ui.menu.hidePopover();
    $('rename-name').value = current.name;
    showError($('rename-error'), '');
    $('dialog-rename').showModal();
    $('rename-name').select();
  }
  $('rename-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await renameServer(current.id, $('rename-name').value);
      $('dialog-rename').close();
      await load(current.id);
    } catch (err) {
      showError($('rename-error'), err.message);
    }
  });

  function openInvite() {
    if (ui.menu.matches(':popover-open')) ui.menu.hidePopover();
    if (!current) return;
    $('invite-server-name').textContent = current.name;
    $('invite-result').hidden = true;
    $('invite-note').hidden = true;
    showError($('invite-error'), '');
    $('dialog-invite').showModal();
  }
  $('invite-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const days = Number($('invite-days').value);
    const usesValue = $('invite-uses').value;
    const uses = usesValue === '' ? null : Number(usesValue);
    try {
      const invite = await createServerInvite(current.id, days, uses);
      $('invite-url').value = invite.url;
      $('invite-result').hidden = false;
      $('invite-note').textContent = `Vale ${days === 1 ? '1 dia' : `${days} dias`}, ${uses === null ? 'sem limite de pessoas' : uses === 1 ? 'para 1 pessoa' : `para até ${uses} pessoas`}. Quem não tem conta se cadastra pelo próprio link.`;
      $('invite-note').hidden = false;
      showError($('invite-error'), '');
      $('invite-url').select();
    } catch (err) {
      showError($('invite-error'), err.message);
    }
  });
  $('invite-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('invite-url').value);
      $('invite-copy').textContent = 'Copiado!';
      setTimeout(() => { $('invite-copy').textContent = 'Copiar'; }, 1500);
    } catch {
      $('invite-url').select(); // sem permissão: deixa selecionado para copiar com ⌘C
    }
  });

  async function openMembers() {
    ui.menu.hidePopover();
    const list = $('members-list');
    list.replaceChildren();
    $('dialog-members').showModal();
    try {
      const members = await listMembers(current.id);
      $('dialog-members-title').textContent = `Membros (${members.length})`;
      list.replaceChildren(...members.map((m) => {
        const li = document.createElement('li');
        const avatar = document.createElement('span');
        avatar.className = 'avatar';
        avatar.setAttribute('aria-hidden', 'true');
        options.paintAvatar(avatar, m.displayName);
        const name = document.createElement('span');
        name.textContent = m.displayName;
        li.append(avatar, name);
        if (m.isOwner) {
          const tag = document.createElement('span');
          tag.className = 'member-owner';
          tag.textContent = 'DONO';
          li.append(tag);
        }
        return li;
      }));
    } catch (err) {
      const li = document.createElement('li');
      li.textContent = err.message;
      list.append(li);
    }
  }

  function openDelete() {
    ui.menu.hidePopover();
    const server = current;
    confirmAction({
      title: `Apagar "${server.name}"?`,
      text: 'Canais, mensagens e convites serão apagados para todos. Quem estiver na chamada sai na hora. Não dá para desfazer.',
      ok: 'Apagar servidor',
      action: async () => {
        await deleteServer(server.id);
        await load(null);
        options.onStatus(`Servidor "${server.name}" apagado.`);
      },
    });
  }

  function openLeave() {
    ui.menu.hidePopover();
    const server = current;
    confirmAction({
      title: `Sair de "${server.name}"?`,
      text: 'Você só volta com um novo convite.',
      ok: 'Sair do servidor',
      action: async () => {
        await leaveServer(server.id);
        await load(null);
        options.onStatus(`Você saiu de "${server.name}".`);
      },
    });
  }

  ui.add.addEventListener('click', openCreate);
  ui.noServerCreate.addEventListener('click', openCreate);
  ui.invite.addEventListener('click', openInvite);
  ui.members.addEventListener('click', openMembers);
  ui.rename.addEventListener('click', openRename);
  ui.remove.addEventListener('click', openDelete);
  ui.leave.addEventListener('click', openLeave);
  ui.pasteForm.addEventListener('submit', (e) => {
    e.preventDefault();
    // Aceita o link inteiro ou só o código.
    const raw = ui.paste.value.trim();
    let code = raw;
    try { code = new URL(raw).searchParams.get('convite') ?? raw; } catch { /* era só o código */ }
    if (code) location.href = `/auth.html?modo=convite&convite=${encodeURIComponent(code)}`;
  });

  return {
    load,
    renderChannels,
    openInvite,
    get current() { return current; },
    serverOfChannel: (channelId) => servers.find((s) => s.channels.some((c) => c.id === channelId)) ?? null,
  };
}

/** Iniciais do servidor para o ícone: "Turma da Quinta" → "TQ". */
function initials(name) {
  const words = name.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w[0] ?? ''));
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return picked.map((w) => [...w][0].toUpperCase()).join('').slice(0, 2) || '?';
}
