import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthApiService } from './auth-api.service';
import { RegisterRequest, UserDto } from './auth.models';

/**
 * Usuário logado. Carregado uma vez na subida do app (GET /api/auth/me); depois só muda com
 * login, cadastro, logout ou uma resposta 401 (sessão expirada).
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(AuthApiService);

  private readonly _user = signal<UserDto | null>(null);
  private loading: Promise<void> | null = null;

  readonly user = this._user.asReadonly();
  readonly isLoggedIn = computed(() => this._user() !== null);

  /** Descobre se há sessão. Chamadas repetidas reaproveitam a mesma requisição. */
  loadAsync(): Promise<void> {
    this.loading ??= this.api.meAsync().then(
      (user) => this._user.set(user),
      (error: unknown) => {
        // 401 = sem sessão. Outros erros (servidor fora do ar) também deixam deslogado.
        if (!(error instanceof HttpErrorResponse)) console.error(error);
        this._user.set(null);
      });
    return this.loading;
  }

  async loginAsync(login: string, password: string): Promise<void> {
    this._user.set(await this.api.loginAsync(login, password));
  }

  async registerAsync(request: RegisterRequest): Promise<void> {
    this._user.set(await this.api.registerAsync(request));
  }

  async logoutAsync(): Promise<void> {
    try {
      await this.api.logoutAsync();
    } finally {
      this._user.set(null);
    }
  }

  /** A sessão acabou do lado do servidor (resposta 401). */
  clearSession(): void {
    this._user.set(null);
  }
}
