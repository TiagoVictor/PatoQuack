// Preferências locais do navegador (dispositivos, qualidade, opções da chamada). Falhas de
// storage (aba anônima, bloqueio) nunca quebram o app: voltam ao padrão.

export function readBool(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

export function readNumber(key: string, fallback: number, min = -Infinity, max = Infinity): number {
  try {
    const raw = localStorage.getItem(key);
    const value = raw === null ? NaN : Number.parseFloat(raw);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  } catch {
    return fallback;
  }
}

export function readString(key: string): string | null {
  try { return localStorage.getItem(key) || null; } catch { return null; }
}

export function writePref(key: string, value: string | number | boolean | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch { /* storage indisponível */ }
}
