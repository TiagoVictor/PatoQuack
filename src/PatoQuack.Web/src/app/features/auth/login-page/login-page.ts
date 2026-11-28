import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { safeReturnUrl } from '../../../core/auth/auth.guards';
import { AuthStore } from '../../../core/auth/auth.store';
import { errorMessage } from '../../../core/util/error-message';
import { Button, Card, FormField, Label, TextInput } from '../../../shared/ui';

@Component({
  selector: 'pq-login-page',
  imports: [ReactiveFormsModule, RouterLink, Button, Card, FormField, Label, TextInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pq-card>
      <div pqCardHeader><h2 class="title">Entrar</h2></div>
      <form [formGroup]="form" (ngSubmit)="submitAsync()">
        <pq-form-field label="E-mail ou usuário" for="login" required>
          <input pqInput id="login" formControlName="login" autocomplete="username" />
        </pq-form-field>
        <pq-form-field label="Senha" for="password" required [error]="error()">
          <input pqInput id="password" type="password" formControlName="password" autocomplete="current-password" />
        </pq-form-field>
        <button pqButton type="submit" variant="primary" block [loading]="busy()">Entrar</button>
      </form>
      <pq-label tone="muted" size="sm" class="switch">
        Não tem conta? <a routerLink="/cadastro" [queryParams]="voltar() ? { voltar: voltar() } : {}">Criar conta</a>
      </pq-label>
    </pq-card>
  `,
  styleUrl: '../auth-card.css',
})
export class LoginPage {
  /** ?voltar=/caminho para onde ir depois de entrar. */
  readonly voltar = input<string>();

  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly form = new FormGroup({
    login: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submitAsync(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Informe o e-mail ou usuário e a senha.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    try {
      const { login, password } = this.form.getRawValue();
      await this.auth.loginAsync(login.trim(), password);
      await this.router.navigateByUrl(safeReturnUrl(this.voltar()));
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
