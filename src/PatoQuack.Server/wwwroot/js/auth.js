// Página de conta (auth.html). Um formulário com 6 modos, escolhidos por ?modo=:
//   entrar · cadastro (com ?convite=) · confirmar (link do e-mail) · esqueci · redefinir (link) ·
//   configurar (primeiro acesso: cria o administrador).
// ?sala= é preservado para levar a pessoa à sala certa depois de entrar.

import { api, getAuthState } from './api.js';

const $ = (id) => document.getElementById(id);
const ui = {
  title: $('auth-title'),
  intro: $('auth-intro'),
  form: $('auth-form'),
  fieldEmail: $('field-email'),
  fieldName: $('field-name'),
  fieldPassword: $('field-password'),
  fieldPassword2: $('field-password2'),
  email: $('email'),
  name: $('display-name'),
  password: $('password'),
  password2: $('password2'),
  hint: $('password-hint'),
  submit: $('auth-submit'),
  status: $('auth-status'),
  resend: $('auth-resend'),
  links: $('auth-links'),
};

const params = new URLSearchParams(location.search);
const room = params.get('sala');
let mode = params.get('modo') ?? 'entrar';

/** Endereço da sala (para onde ir depois de entrar). */
const homeUrl = () => (room ? `/?sala=${encodeURIComponent(room)}` : '/');
const authUrl = (m, extra = {}) => {
  const q = new URLSearchParams({ modo: m, ...(room ? { sala: room } : {}), ...extra });
  return `/auth.html?${q}`;
};

function setStatus(message, level = 'info') {
  ui.status.textContent = message;
  ui.status.dataset.level = level;
}

function link(text, href) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  return a;
}

/** Mostra só os campos do modo. */
function layout({ title, intro = '', email = false, name = false, password = false, password2 = false, submit = '', newPassword = false }) {
  document.title = `PatoQuack · ${title}`;
  ui.title.textContent = title;
  ui.intro.textContent = intro;
  ui.intro.hidden = !intro;
  ui.fieldEmail.hidden = !email;
  ui.fieldName.hidden = !name;
  ui.fieldPassword.hidden = !password;
  ui.fieldPassword2.hidden = !password2;
  ui.hint.hidden = !newPassword;
  ui.form.hidden = !submit;
  ui.submit.textContent = submit;
  ui.password.autocomplete = newPassword ? 'new-password' : 'current-password';
  for (const [field, input] of [[email, ui.email], [name, ui.name], [password, ui.password], [password2, ui.password2]]) {
    input.required = field;
  }
}

function setLinks(...items) {
  ui.links.replaceChildren(...items.map(([text, href]) => link(text, href)));
}

/** Valida no navegador o que dá (o servidor valida de novo). */
function checkForm({ needsMatch = false } = {}) {
  if (!ui.form.reportValidity()) return false;
  if (needsMatch && ui.password.value !== ui.password2.value) {
    setStatus('As senhas não são iguais.', 'error');
    ui.password2.focus();
    return false;
  }
  return true;
}

async function busy(fn) {
  ui.submit.disabled = true;
  try {
    await fn();
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    ui.submit.disabled = false;
  }
}

// ---- modos ------------------------------------------------------------------------

const modes = {
  async entrar() {
    layout({ title: 'Entrar', email: true, password: true, submit: 'Entrar' });
    setLinks(['Esqueci a senha', authUrl('esqueci')]);
    ui.form.onsubmit = (e) => {
      e.preventDefault();
      if (!checkForm()) return;
      busy(async () => {
        try {
          await api('/api/auth/login', { method: 'POST', body: { email: ui.email.value, password: ui.password.value } });
          location.replace(homeUrl());
        } catch (err) {
          // 403 = senha certa, mas o e-mail não foi confirmado: oferece reenviar o link.
          ui.resend.hidden = err.status !== 403;
          throw err;
        }
      });
    };
    ui.resend.onclick = () => busy(async () => {
      await api('/api/auth/resend-confirmation', { method: 'POST', body: { email: ui.email.value } });
      ui.resend.hidden = true;
      setStatus('Enviamos um novo link de confirmação. Confira sua caixa de entrada (e o spam).');
    });
  },

  async cadastro() {
    const code = params.get('convite');
    layout({ title: 'Criar conta', email: true, name: true, password: true, password2: true, submit: 'Criar conta', newPassword: true });
    setLinks(['Já tenho conta', authUrl('entrar')]);
    const info = code ? await api(`/api/invites/${encodeURIComponent(code)}`).catch(() => null) : null;
    if (!info?.valid) {
      layout({ title: 'Convite inválido' });
      setStatus('Este convite não existe, venceu ou já foi usado. Peça um novo a quem te convidou.', 'error');
      return;
    }
    ui.intro.textContent = info.inviterName ? `${info.inviterName} te convidou para o PatoQuack.` : 'Você foi convidado para o PatoQuack.';
    ui.intro.hidden = false;
    ui.form.onsubmit = (e) => {
      e.preventDefault();
      if (!checkForm({ needsMatch: true })) return;
      busy(async () => {
        await api('/api/auth/register', { method: 'POST', body: { invite: code, email: ui.email.value, displayName: ui.name.value, password: ui.password.value } });
        layout({ title: 'Confirme seu e-mail' });
        setLinks(['Ir para o login', authUrl('entrar')]);
        setStatus(`Conta criada! Enviamos um link para ${ui.email.value}. Abra o link para ativar a conta e depois entre.`);
      });
    };
  },

  async confirmar() {
    layout({ title: 'Confirmando…' });
    try {
      await api('/api/auth/confirm', { method: 'POST', body: { userId: params.get('uid'), token: params.get('token') } });
      layout({ title: 'Conta confirmada' });
      setStatus('Pronto! Sua conta está ativa.');
      setLinks(['Entrar', authUrl('entrar')]);
    } catch (err) {
      layout({ title: 'Link inválido' });
      setStatus(err.message, 'error');
      setLinks(['Ir para o login', authUrl('entrar')]);
    }
  },

  async esqueci() {
    layout({ title: 'Esqueci a senha', intro: 'Informe o e-mail da conta. Enviaremos um link para criar uma senha nova.', email: true, submit: 'Enviar link' });
    setLinks(['Voltar para o login', authUrl('entrar')]);
    ui.form.onsubmit = (e) => {
      e.preventDefault();
      if (!checkForm()) return;
      busy(async () => {
        await api('/api/auth/forgot', { method: 'POST', body: { email: ui.email.value } });
        layout({ title: 'Confira seu e-mail' });
        // Mesma mensagem exista ou não a conta (não revelamos quem tem cadastro).
        setStatus('Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha.');
      });
    };
  },

  async redefinir() {
    layout({ title: 'Nova senha', password: true, password2: true, submit: 'Salvar senha', newPassword: true });
    setLinks(['Voltar para o login', authUrl('entrar')]);
    ui.form.onsubmit = (e) => {
      e.preventDefault();
      if (!checkForm({ needsMatch: true })) return;
      busy(async () => {
        await api('/api/auth/reset', { method: 'POST', body: { userId: params.get('uid'), token: params.get('token'), password: ui.password.value } });
        layout({ title: 'Senha alterada' });
        setStatus('Senha alterada. Agora é só entrar com a senha nova.');
        setLinks(['Entrar', authUrl('entrar')]);
      });
    };
  },

  async configurar() {
    layout({
      title: 'Primeiro acesso',
      intro: 'Crie a conta de administrador do PatoQuack. Depois, convide as outras pessoas pelo menu ⋯ da sala.',
      email: true, name: true, password: true, password2: true, submit: 'Criar administrador', newPassword: true,
    });
    setLinks();
    ui.form.onsubmit = (e) => {
      e.preventDefault();
      if (!checkForm({ needsMatch: true })) return;
      busy(async () => {
        await api('/api/auth/setup', { method: 'POST', body: { email: ui.email.value, displayName: ui.name.value, password: ui.password.value } });
        location.replace(homeUrl());
      });
    };
  },
};

// ---- início ----------------------------------------------------------------------

async function start() {
  let state;
  try {
    state = await getAuthState();
  } catch (err) {
    setStatus(err.message, 'error');
    return;
  }
  if (state.setupRequired) mode = 'configurar';
  else if (mode === 'configurar') mode = 'entrar';
  // Já logado: entrar/configurar não fazem sentido, vai direto para a sala.
  if (state.user && (mode === 'entrar' || mode === 'configurar')) {
    location.replace(homeUrl());
    return;
  }
  await (modes[mode] ?? modes.entrar)();
  [...ui.form.querySelectorAll('label')].find((label) => !label.hidden)?.querySelector('input')?.focus();
}

start();
