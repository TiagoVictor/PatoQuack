import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';

// inject() só funciona antes do primeiro await (contexto de injeção síncrono).

/** Só entra logado; senão vai para /entrar e volta depois para onde ia. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  await auth.loadAsync();
  return auth.isLoggedIn() || router.createUrlTree(['/entrar'], { queryParams: { voltar: state.url } });
};

/** Telas de login/cadastro: quem já está logado vai para o início. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  await auth.loadAsync();
  return !auth.isLoggedIn() || router.createUrlTree(['/']);
};

/** Só aceita caminhos internos no "voltar" (evita redirecionar para outro site). */
export function safeReturnUrl(value: string | null | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}
