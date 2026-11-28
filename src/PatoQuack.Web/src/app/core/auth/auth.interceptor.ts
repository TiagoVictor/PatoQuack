import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthStore } from './auth.store';

/** Cabeçalho que o servidor exige em toda chamada que muda dados (proteção contra CSRF). */
export const CSRF_HEADER = 'X-PatoQuack';

/**
 * - Manda o cabeçalho de segurança nas chamadas da API que mudam dados.
 * - 401 numa chamada da API (fora do próprio /auth) = a sessão expirou: limpa o usuário e manda
 *   para o login, voltando depois para a tela atual.
 */
export const authInterceptor: HttpInterceptorFn = (incoming, next) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  const request = incoming.method === 'GET' || incoming.method === 'HEAD'
    ? incoming
    : incoming.clone({ setHeaders: { [CSRF_HEADER]: '1' } });

  return next(request).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !request.url.includes('/auth/')) {
        auth.clearSession();
        void router.navigate(['/entrar'], { queryParams: { voltar: router.url } });
      }
      return throwError(() => error);
    }),
  );
};
