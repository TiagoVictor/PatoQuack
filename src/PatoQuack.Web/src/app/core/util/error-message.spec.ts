import { errorMessage } from './error-message';

describe('errorMessage', () => {
  it('extrai a mensagem da HubException', () => {
    const error = new Error("An unexpected error occurred invoking 'JoinRoom' on the server. HubException: A sala está cheia.");
    expect(errorMessage(error)).toBe('A sala está cheia.');
  });

  it('usa a mensagem original quando não é HubException', () => {
    expect(errorMessage(new Error('falhou'))).toBe('falhou');
    expect(errorMessage('texto')).toBe('texto');
  });
});

describe('errorMessage com HTTP', () => {
  it('usa o detail do ProblemDetails', async () => {
    const { HttpErrorResponse } = await import('@angular/common/http');
    const error = new HttpErrorResponse({ status: 404, error: { title: 'x', detail: 'Nenhum servidor com esse código de convite.' } });
    expect(errorMessage(error)).toBe('Nenhum servidor com esse código de convite.');
    expect(errorMessage(new HttpErrorResponse({ status: 0 }))).toContain('Servidor indisponível');
  });
});
