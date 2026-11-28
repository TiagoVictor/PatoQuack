import { HttpErrorResponse } from '@angular/common/http';

/**
 * Mensagem legível de um erro:
 * - HttpErrorResponse com ProblemDetails: o "detail" do servidor;
 * - HubException do SignalR, que chega como
 *   "An unexpected error occurred invoking 'X' on the server. HubException: <msg>";
 * - qualquer outro Error: a mensagem.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'Servidor indisponível. Verifique se o PatoQuack.Server está rodando.';
    if (error.status === 429 && !(error.error as { detail?: unknown } | null)?.detail) {
      return 'Muitas tentativas seguidas. Espere um minuto e tente de novo.';
    }
    const detail = (error.error as { detail?: unknown } | null)?.detail;
    return typeof detail === 'string' ? detail : error.message;
  }

  const text = error instanceof Error ? error.message : String(error);
  const match = text.match(/HubException: (.*)$/);
  return match ? match[1] : text;
}

export function errorName(error: unknown): string | undefined {
  return error instanceof Error || error instanceof DOMException ? error.name : undefined;
}
