// 12 caracteres (convites novos) ou 8 (convites criados antes da validade/limite de usos).
const INVITE_CODE = /^(?:[a-hjkmnp-z2-9]{12}|[a-hjkmnp-z2-9]{8})$/;

/**
 * Extrai o código de convite do que a pessoa colou: o código puro ("abcd2345") ou um link
 * ("http://host/convite/abcd2345"). Retorna null se não houver código válido.
 */
export function parseInviteCode(input: string): string | null {
  const text = input.trim();
  const fromLink = text.match(/\/convite\/([^/?#\s]+)/);
  const code = (fromLink ? fromLink[1] : text).toLowerCase();
  return INVITE_CODE.test(code) ? code : null;
}
