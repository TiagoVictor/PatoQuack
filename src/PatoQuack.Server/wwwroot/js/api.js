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
// Servidores
export const listServers = () => api('/api/servers');
export const createServer = (name) => api('/api/servers', { method: 'POST', body: { name } });
export const renameServer = (id, name) => api(`/api/servers/${id}`, { method: 'PATCH', body: { name } });
export const deleteServer = (id) => api(`/api/servers/${id}`, { method: 'DELETE' });
export const leaveServer = (id) => api(`/api/servers/${id}/leave`, { method: 'POST' });
export const listMembers = (id) => api(`/api/servers/${id}/members`);
/** Convite do servidor: expiresInDays 1|7|30, maxUses 1|10|null (sem limite). */
export const createServerInvite = (id, expiresInDays, maxUses) =>
  api(`/api/servers/${id}/invites`, { method: 'POST', body: { expiresInDays, maxUses } });
export const getInvite = (code) => api(`/api/invites/${encodeURIComponent(code)}`);
export const acceptInvite = (code) => api(`/api/invites/${encodeURIComponent(code)}/accept`, { method: 'POST' });
