// Chamadas à API de contas/convites. Toda chamada leva o cabeçalho X-PatoQuack: o servidor
// recusa sem ele (proteção contra requisição forjada vinda de outro site).

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** @returns {Promise<any>} JSON da resposta (ou null). Lança ApiError com a mensagem do servidor. */
export async function api(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'X-PatoQuack': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Sem conexão com o servidor. Tente de novo.', 0);
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* resposta sem JSON */ }
  if (!response.ok) {
    const fallback = response.status === 429 ? 'Muitas tentativas. Espere um minuto e tente de novo.' : 'Não foi possível concluir. Tente de novo.';
    throw new ApiError(data?.error ?? fallback, response.status);
  }
  return data;
}

/** Estado da sessão: { setupRequired, user: { id, email, displayName, isAdmin } | null } */
export const getAuthState = () => api('/api/auth/state');
export const logout = () => api('/api/auth/logout', { method: 'POST' });
export const createInvite = (room) => api('/api/invites', { method: 'POST', body: { room } });
